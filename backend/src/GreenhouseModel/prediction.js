const { spawn } = require("child_process");
const path = require("path");

const backendRoot = path.resolve(__dirname, "../../");

function getPrediction(deviceType, inputData) {
  return new Promise((resolve, reject) => {
    let scriptPath;
    let requiredKeys = [];

    // 1. Cấu hình đường dẫn và key bắt buộc cho từng loại thiết bị
    switch (deviceType) {
      case "fan":
        scriptPath = path.join(
          backendRoot,
          "src",
          "GreenhouseModel",
          "fan_control",
          "infer_fan_control.py"
        );
        // Lưu ý: Tên key này phải khớp với output từ sensorService.js
        requiredKeys = ["temperature", "humidity"];
        break;

      case "led":
        scriptPath = path.join(
          backendRoot,
          "src",
          "GreenhouseModel",
          "led_control",
          "infer_led_control.py"
        );
        requiredKeys = [
          "Light_Intensity",
          "Temperature",
          "Humidity",
          "Minute_Of_Day",
        ];
        break;

      case "pump":
        scriptPath = path.join(
          backendRoot,
          "src",
          "GreenhouseModel",
          "pump_control",
          "infer_pump_control.py"
        );
        requiredKeys = ["Soil Moisture", "Temperature", "Air humidity (%)"];
        break;

      default:
        return reject(
          new Error(`Invalid device type for prediction: ${deviceType}`)
        );
    }

    // 2. Kiểm tra dữ liệu đầu vào có đủ key không
    const missingKeys = requiredKeys.filter((key) => !(key in inputData));
    if (missingKeys.length > 0) {
      return reject(
        new Error(
          `Missing required input data keys for ${deviceType}: ${missingKeys.join(
            ", "
          )}`
        )
      );
    }

    // 3. Chuẩn bị dữ liệu gửi sang Python
    const relevantInputData = {};
    requiredKeys.forEach((key) => {
      relevantInputData[key] = inputData[key];
    });

    // --- SỬA LỖI TẠI ĐÂY: Dùng trực tiếp relevantInputData ---
    const inputJson = JSON.stringify(relevantInputData); 
    
    const pythonExecutable = "python"; // Hoặc "python3" nếu chạy trên Linux/Mac

    console.log(
      `Running Python script: ${pythonExecutable} ${scriptPath} ${inputJson}`
    );
    
    const scriptDir = path.dirname(scriptPath);
    const pythonProcess = spawn(pythonExecutable, [scriptPath, inputJson], {
      cwd: scriptDir,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });

    let prediction = "";
    let errorOutput = "";

    pythonProcess.stdout.setEncoding("utf8");
    pythonProcess.stderr.setEncoding("utf8");

    pythonProcess.stdout.on("data", (data) => {
      prediction += data.toString();
      console.log(`Python stdout (${deviceType}):`, data.toString());
    });

    pythonProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
      console.error(`Python stderr (${deviceType}):`, data.toString());
    });

    pythonProcess.on("close", (code) => {
      console.log(`Python process (${deviceType}) exited with code ${code}`);
      if (code !== 0) {
        // Log lỗi chi tiết từ Python nếu có
        return reject(
          new Error(
            `Python process failed with code ${code}. Error: ${
              errorOutput || "Unknown error"
            }`
          )
        );
      } else if (!prediction.trim()) {
        return reject(new Error(`No prediction returned from Python script`));
      } else {
        // Trả về kết quả sạch
        resolve(prediction.trim());
      }
    });

    pythonProcess.on("error", (error) => {
      console.error(`Error starting Python process (${deviceType}):`, error);
      reject(new Error(`Error starting Python process: ${error.message}`));
    });
  });
}

module.exports = {
  getPrediction,
};