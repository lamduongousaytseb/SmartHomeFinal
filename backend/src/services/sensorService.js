const {
  getAdafruitEarthHumidData,
  getAdafruitHumidData,
  getAdafruitLightData,
  getAdafruitThermalData,
} = require("../controllers/adafruitController");
const sensorRepository = require("../repository/sensorRepository");

const {
  getHistory,
  getLatest,
  saveSensor,
} = require("../repository/sensorRepository");

const { getPrediction } = require("../GreenhouseModel/prediction");
const settingsRepository = require("../repository/settingsRepository");
// const mqttClient = require("../utils/mqtt"); // File khởi tạo client gốc

// Định nghĩa hàm publish ngay trong file này để tránh phụ thuộc
function publishToFeed(feedKey, message) {
  const mqttClient = require("../utils/mqtt");
  if (mqttClient && mqttClient.connected) {
    const topic = `dgialam/feeds/${feedKey}`;
    mqttClient.publish(topic, String(message));
    console.log(`[MQTT Direct] Sent to ${topic}: ${message}`);
  } else {
    console.error("[MQTT Direct] Client not connected");
  }
}


// --- HELPER FUNCTIONS ---
const DEVICE_FEED_MAP = {
  fan: "fan-control",
  pump: "water-pump",
  led: "light-control",
};

function getFeedKey(deviceName) {
  return DEVICE_FEED_MAP[deviceName] || null;
}

function determineMQttPayload(deviceName, setting) {
  return setting.status ? "1" : "0";
}

// -----------------------------------------------------------------------

const TARGET_HOURS = [8, 9, 12, 15, 18, 20, 23];
const SENSOR_TYPES = ["thermal", "humid", "earth-humid", "light"];

class SensorService {
  async syncFeed(feedKey) {
    let fetchFeedDataFn;

    try {
      switch (feedKey) {
        case "humid":
          fetchFeedDataFn = getAdafruitHumidData;
          break;
        case "thermal":
          fetchFeedDataFn = getAdafruitThermalData;
          break;
        case "light":
          fetchFeedDataFn = getAdafruitLightData;
          break;
        case "earth-humid":
          fetchFeedDataFn = getAdafruitEarthHumidData;
          break;
        default:
          throw new Error("Invalid feed key");
      }

      const feedData = await fetchFeedDataFn();

      if (!Array.isArray(feedData)) return;

      // Lưu ý: Chỉ lưu nếu có dữ liệu mới để tránh spam DB, 
      // nhưng với logic hiện tại cứ lưu đè hoặc insert mới tùy repo
      for (const item of feedData) {
        const { value, created_at } = item;
        if (!value || !created_at) continue;
        // console.log(`[DB Saving] ${feedKey} = ${value}`);
        await saveSensor(feedKey, value, created_at);
      }
      // console.log(`[Sync] Updated ${feedKey}`);
    } catch (error) {
      console.error(`[Sync Error] ${feedKey}:`, error.message);
    }
  }

  async getFeedLatest(feedKey) {
    return getLatest(feedKey);
  }

  async getFeedHistory(feedKey, startTime, endTime, page, pageSize) {
    return getHistory(feedKey, startTime, endTime, page, pageSize);
  }

  async getDailyDashboardData(date) {
    const startTime = `${date} 00:00:00`;
    const endTime = `${date} 23:59:59`;
    const dashboardData = {};
    const keyMapping = {
      thermal: "temperature",
      humid: "humidity",
      "earth-humid": "soil_moisture",
      light: "light",
    };

    for (const sensorType of SENSOR_TYPES) {
      const rawData = await sensorRepository.getDailySensorData(
        sensorType,
        startTime,
        endTime
      );
      const processedData = this.processSensorDataForHours(
        rawData,
        TARGET_HOURS
      );
      const responseKey = keyMapping[sensorType] || sensorType;
      dashboardData[responseKey] = processedData;
    }
    return dashboardData;
  }

  processSensorDataForHours(rawData, targetHours) {
    if (!rawData || rawData.length === 0) {
      return targetHours.map((hour) => ({
        label: String(hour),
        value: null,
      }));
    }
    rawData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const finalResults = [];

    for (const hour of targetHours) {
      let closestData = null;
      let minDiff = Infinity;
      let found = false;

      for (const item of rawData) {
        const itemDate = new Date(item.timestamp);
        const itemHour = itemDate.getHours();
        const itemMinutes = itemDate.getMinutes();
        const itemTimeValue = itemHour + itemMinutes / 60;
        const diff = Math.abs(itemTimeValue - hour);

        if (diff < minDiff) {
          minDiff = diff;
          closestData = item;
          found = true;
        }
        if (itemTimeValue > hour + 1 && found) break;
      }

      finalResults.push({
        label: String(hour),
        value: closestData ? Math.round(parseFloat(closestData.value)) : null,
      });
    }
    return finalResults;
  }

  async getLatestSensorData() {
    try {
      const data = await sensorRepository.getLatestSensorData();
      if (!data) return { message: "No data found" };
      return data;
    } catch (error) {
      console.error("Error getting latest sensor data:", error);
      throw error;
    }
  }

  // --- LOGIC AI ---
  async triggerAutomationControl() {
    // console.log("[AutoControl] Checking...");
    let allSettings;
    let latestSensorObj = {};

    try {
      allSettings = await settingsRepository.getAllSettings();
      const latestSensorsArray = await sensorRepository.getLatestSensorData();

      if (!allSettings || !latestSensorsArray || latestSensorsArray.length === 0) {
        return;
      }

      latestSensorObj = latestSensorsArray.reduce((acc, sensor) => {
        let keyName = sensor.name;
        if (keyName === "soil-moisture") keyName = "earth-humid";
        else if (keyName === "temperature") keyName = "thermal";
        else if (keyName === "humidity") keyName = "humid";
        else if (keyName === "light") keyName = "light";
        acc[keyName] = sensor;
        return acc;
      }, {});

    } catch (error) {
      console.error("[AutoControl] Error fetching data:", error);
      return;
    }

    for (const setting of allSettings) {
      if (setting.mode === "automatic") {
        const deviceName = setting.name;
        let relevantInputData = {};
        let canPredict = true;

        switch (deviceName) {
          case "fan":
            if (latestSensorObj["thermal"] && latestSensorObj["humid"]) {
              relevantInputData = {
                temperature: latestSensorObj["thermal"].value,
                humidity: latestSensorObj["humid"].value,
              };
            } else canPredict = false;
            break;
          case "led":
            if (latestSensorObj["light"] && latestSensorObj["thermal"] && latestSensorObj["humid"]) {
              const currentDate = new Date();
              const minuteOfDay = currentDate.getHours() * 60 + currentDate.getMinutes();
              relevantInputData = {
                Light_Intensity: latestSensorObj["light"].value,
                Temperature: latestSensorObj["thermal"].value,
                Humidity: latestSensorObj["humid"].value,
                Minute_Of_Day: minuteOfDay,
              };
            } else canPredict = false;
            break;
          case "pump":
            if (latestSensorObj["earth-humid"] && latestSensorObj["thermal"] && latestSensorObj["humid"]) {
              relevantInputData = {
                "Soil Moisture": latestSensorObj["earth-humid"].value,
                Temperature: latestSensorObj["thermal"].value,
                "Air humidity (%)": latestSensorObj["humid"].value,
              };
            } else canPredict = false;
            break;
          default:
            continue;
        }

        if (canPredict) {
          const notificationService = require("../services/NotificationService");
          try {
            const predictionResult = await getPrediction(deviceName, relevantInputData);
            
            let predictedStatus;
            if (deviceName === "led") {
              predictedStatus = parseInt(predictionResult, 10) === 1;
            } else {
              predictedStatus = predictionResult === "BẬT";
            }

            if (setting.status !== predictedStatus) {
              console.log(`[AutoControl] ${deviceName} SWITCH: ${setting.status} -> ${predictedStatus}`);
              
              const feedKey = getFeedKey(deviceName);
              if (feedKey) {
                const mqttPayload = predictedStatus ? "1" : "0";
                publishToFeed(feedKey, mqttPayload);
                await settingsRepository.updateSettingByName(deviceName, { status: predictedStatus });
                
                // Gửi thông báo
                notificationService.createNotificationForAllUsers(
                    `${deviceName} auto switched ${predictedStatus ? "ON" : "OFF"}`, 
                    "AUTO_CONTROL", 
                    deviceName
                ).catch(e => {});
              }
            }
          } catch (err) {
            console.error(`[AutoControl Error] ${deviceName}:`, err.message);
          }
        }
      }
    }
  }
}

const sensorService = new SensorService();
const FEEDS = ["humid", "light", "earth-humid", "thermal"];

// --- SỬA ĐỔI QUAN TRỌNG: TĂNG TỐC ĐỘ SYNC ---

function startAutoSync() {
  console.log("🚀 Turbo Sync Started: Every 5 seconds");
  setInterval(async () => {
    // Dùng Promise.all để gọi 4 request song song -> Tiết kiệm thời gian
    await Promise.all(FEEDS.map(feed => sensorService.syncFeed(feed)));
  }, 5000); // 5 GIÂY
}

function startControlCheck() {
  console.log("🤖 AI Loop Started: Every 5 seconds");
  setInterval(async () => {
    await sensorService.triggerAutomationControl();
  }, 5000); // 5 GIÂY
}

module.exports = {
  sensorService,
  startAutoSync,
  startControlCheck,
};