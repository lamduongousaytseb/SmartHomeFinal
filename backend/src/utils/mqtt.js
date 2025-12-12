const mqtt = require("mqtt");const { sensorService } = require("../services/sensorService");
require("dotenv").config();
const feeds = [
  "thermal", "humid", "light", "earth-humid", // 4 feeds cảm biến
  "fan", "light-control", "water-pump" // 3 feeds điều khiển (tùy chọn)
];
const client = mqtt.connect("mqtt://io.adafruit.com", {
  username: process.env.ADAFRUIT_IO_USERNAME,
  password: process.env.ADAFRUIT_IO_KEY,
});

client.on("connect", () => {
  console.log("✅ MQTT connected to Adafruit IO");

  const feeds = [
  "thermal", "humid", "light", "earth-humid", // 4 feeds cảm biến
  "fan", "light-control", "water-pump" // 3 feeds điều khiển (tùy chọn)
];

  feeds.forEach((feed) => {
    const topic = `${process.env.ADAFRUIT_IO_USERNAME}/feeds/${feed}`;
    client.subscribe(topic, (err) => {
      if (!err) {
        console.log(`📥 Subscribed to ${topic}`);
      } else {
        console.error(`❌ Failed to subscribe ${topic}:`, err);
      }
    });
  });
});
const SENSOR_FEEDS = ["thermal", "humid", "light", "earth-humid"];

client.on("message", (topic, message) => {
  try {
    const messageStr = message.toString();
    const topicParts = topic.split("/");
    const feedName = topicParts[topicParts.length - 1];

    console.log(`[MQTT] 📨 ${feedName}: ${messageStr}`);

    // Kiểm tra xem đây có phải là feed CẢM BIẾN không
    if (SENSOR_FEEDS.includes(feedName)) {

      const value = messageStr;
      const timestamp = new Date(); 

      console.log(`[MQTT] Sensor data detected. Calling sensorService...`);

      // GỌI HÀM LƯU DATABASE (từ sensorService.js)
      sensorService.saveSensorDataAndTriggerControl(
        feedName,
        value,
        timestamp
      );
    }
  } catch (error) {
    console.error("❌ Error processing MQTT message:", error);
  }
});

client.on("error", (err) => {
  console.error("❌ MQTT Error:", err);
});

module.exports = client;
