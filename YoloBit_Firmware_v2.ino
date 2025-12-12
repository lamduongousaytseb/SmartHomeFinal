/*
 * ==========================================================
 * YOLOBIT FIRMWARE - HỆ THỐNG NHÀ KÍNH TỰ ĐỘNG
 * ==========================================================
 * * CHỨC NĂNG:
 * 1. Đọc 3 cảm biến: DHT11, Ánh sáng (Analog), Độ ẩm đất (Analog).
 * 2. Gửi (Publish) 4 feeds (thermal, humid, light, earth-humid) lên Adafruit IO.
 * 3. Lắng nghe (Subscribe) 3 feeds (fan, light-control, water-pump) từ Adafruit IO.
 * 4. Bật/Tắt 3 Relay (Quạt, Đèn, Bơm) dựa trên lệnh nhận được.
 * */

/*
 * ==========================================================
 * PHẦN 1: KHAI BÁO THƯ VIỆN VÀ CẤU HÌNH
 * ==========================================================
 */
 
#include <WiFi.h>
#include "Adafruit_MQTT.h"
#include "Adafruit_MQTT_Client.h"
#include "DHT.h" // Thư viện cho cảm biến DHT11

// --- 1. THAY THÔNG TIN WI-FI CỦA BẠN ---
#define WIFI_SSID       "Xiaomi 12T Pro"
#define WIFI_PASS       "123456789"

// --- 2. THAY THÔNG TIN ADAFRUIT IO CỦA BẠN ---
// (Lấy từ trang io.adafruit.com -> "My Key")
#define AIO_SERVER      "io.adafruit.com"
#define AIO_SERVERPORT  1883 
#define AIO_USERNAME    "USERNAME_ADAFRUIT_CUA_BAN"
#define AIO_KEY         "KEY_ADAFRUIT_CUA_BAN"

/* * --- 3. KHAI BÁO CHÂN CẮM (PIN) PHẦN CỨNG ---
 * * ⚠️ QUAN TRỌNG: Đây là các chân cắm GIẢ ĐỊNH dựa trên tài liệu Mạch Mở Rộng.
 * Bạn PHẢI kiểm tra phần cứng của mình và sửa lại cho đúng!
 * * Cổng Analog (P0, P1, P2): Dùng cho cảm biến đọc giá trị dải.
 * Cổng Digital (P16/12, P14/15, P10/13, P3/6): Dùng cho BẬT/TẮT.
 */
 
// Cảm biến Analog
#define SOIL_PIN        0  // GIẢ ĐỊNH: Cảm biến độ ẩm đất cắm vào cổng P0 
#define LIGHT_PIN       1  // GIẢ ĐỊNH: Cảm biến ánh sáng cắm vào cổng P1

// Cảm biến Digital
#define DHT_PIN         15  // GIẢ ĐỊNH: Cảm biến DHT11 cắm vào cổng P14/15 (dùng chân 15)
#define DHT_TYPE        DHT11 // Loại cảm biến là DHT11

// Thiết bị Digital (Relay)
#define FAN_RELAY_PIN   12  // GIẢ ĐỊNH: Relay Quạt cắm vào cổng P16/12 (dùng chân 12)
#define LED_RELAY_PIN   13  // GIẢ ĐỊNH: Relay Đèn cắm vào cổng P10/13 (dùng chân 13)
#define PUMP_RELAY_PIN  6   // GIẢ ĐỊNH: Relay Bơm cắm vào cổng P3/6 (dùng chân 6)


// --- KHỞI TẠO CÁC ĐỐI TƯỢNG ---

// Khởi tạo cảm biến DHT
DHT dht(DHT_PIN, DHT_TYPE);

// Khởi tạo máy khách Wi-Fi
WiFiClient client;

// Khởi tạo máy khách MQTT
Adafruit_MQTT_Client mqtt(&client, AIO_SERVER, AIO_SERVERPORT, AIO_USERNAME, AIO_KEY);

// --- KHAI BÁO CÁC "FEEDS" (CHỦ ĐỀ MQTT) ---

// 1. Feeds để "Gửi" (Publish) dữ liệu cảm biến LÊN:
Adafruit_MQTT_Publish thermal_feed = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/thermal");
Adafruit_MQTT_Publish humid_feed = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/humid");
Adafruit_MQTT_Publish light_feed = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/light");
Adafruit_MQTT_Publish earth_humid_feed = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/earth-humid");

// 2. Feeds để "Nhận" (Subscribe) lệnh điều khiển VỀ:
Adafruit_MQTT_Subscribe fan_feed = Adafruit_MQTT_Subscribe(&mqtt, AIO_USERNAME "/feeds/fan");
Adafruit_MQTT_Subscribe light_control_feed = Adafruit_MQTT_Subscribe(&mqtt, AIO_USERNAME "/feeds/light-control");
Adafruit_MQTT_Subscribe water_pump_feed = Adafruit_MQTT_Subscribe(&mqtt, AIO_USERNAME "/feeds/water-pump");


/*
 * ==========================================================
 * PHẦN 2: HÀM SETUP() - CHẠY 1 LẦN KHI KHỞI ĐỘNG
 * ==========================================================
 */
void setup() {
  Serial.begin(115200);
  Serial.println("Khoi dong Yolo:Bit Firmware v2...");

  // Cài đặt các chân Relay là OUTPUT (để xuất tín hiệu)
  pinMode(FAN_RELAY_PIN, OUTPUT);
  pinMode(LED_RELAY_PIN, OUTPUT);
  pinMode(PUMP_RELAY_PIN, OUTPUT);

  // Cài đặt chân cảm biến Analog là INPUT
  pinMode(SOIL_PIN, INPUT);
  pinMode(LIGHT_PIN, INPUT);
  
  // Tắt hết thiết bị khi mới khởi động
  digitalWrite(FAN_RELAY_PIN, LOW); // LOW = TẮT (Relay kích hoạt mức CAO)
  digitalWrite(LED_RELAY_PIN, LOW);
  digitalWrite(PUMP_RELAY_PIN, LOW);

  // Khởi động cảm biến DHT
  dht.begin();

  // Kết nối Wi-Fi
  Serial.print("Dang ket noi Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nDa ket noi Wi-Fi!");

  // Đăng ký (Subscribe) các feeds điều khiển
  mqtt.subscribe(&fan_feed);
  mqtt.subscribe(&light_control_feed);
  mqtt.subscribe(&water_pump_feed);
}

// Biến đếm thời gian để gửi dữ liệu mỗi 10 giây
long lastSendTime = 0;

/*
 * ==========================================================
 * PHẦN 3: HÀM LOOP() - CHẠY LẶP ĐI LẶP LẠI MÃI MÃI
 * ==========================================================
 */
void loop() {
  // Hàm này đảm bảo kết nối MQTT luôn được duy trì
  MQTT_connect();

  // --- XỬ LÝ LỆNH NHẬN VỀ (SUBSCRIBE) ---
  // (Luôn luôn lắng nghe, không cần chờ)
  Adafruit_MQTT_Subscribe *subscription;
  while ((subscription = mqtt.readSubscription(5000))) {
    
    char *data = (char *)subscription->lastread;
    Serial.print("Nhan lenh: "); Serial.println(data);

    // 1. Kiểm tra nếu có lệnh cho QUẠT
    if (subscription == &fan_feed) {
      if (strcmp(data, "1") == 0) {
        digitalWrite(FAN_RELAY_PIN, HIGH); // BẬT QUẠT
      } else { 
        digitalWrite(FAN_RELAY_PIN, LOW);  // TẮT QUẠT
      }
    }

    // 2. Kiểm tra nếu có lệnh cho ĐÈN
    if (subscription == &light_control_feed) {
      if (strcmp(data, "1") == 0) {
        digitalWrite(LED_RELAY_PIN, HIGH); // BẬT ĐÈN
      } else {
        digitalWrite(LED_RELAY_PIN, LOW);  // TẮT ĐÈN
      }
    }

    // 3. Kiểm tra nếu có lệnh cho BƠM
    if (subscription == &water_pump_feed) {
      if (strcmp(data, "1") == 0) {
        digitalWrite(PUMP_RELAY_PIN, HIGH); // BẬT BƠM
      } else {
        digitalWrite(PUMP_RELAY_PIN, LOW);  // TẮT BƠM
      }
    }
  }

  // --- XỬ LÝ GỬI DỮ LIỆU CẢM BIẾN (PUBLISH) ---
  // Chỉ gửi mỗi 10 giây 1 lần
  if (millis() - lastSendTime > 10000) {
    Serial.println("-------------------------");
    Serial.println("Doc & Gui du lieu cam bien...");

    // Đọc cảm biến DHT
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    // Đọc cảm biến Analog (Yolo:Bit ESP32 dùng 12-bit ADC, 0-4095)
    int lightValue = analogRead(LIGHT_PIN);
    int soilValue = analogRead(SOIL_PIN);

    // Kiểm tra đọc lỗi DHT
    if (isnan(h) || isnan(t)) {
      Serial.println("Loi doc cam bien DHT!");
    } else {
      // Gửi dữ liệu lên Adafruit IO
      thermal_feed.publish(t);
      humid_feed.publish(h);
      Serial.print("[PUB] Nhiet do: "); Serial.print(t);
      Serial.print(" | Do am KK: "); Serial.println(h);
    }

    // Gửi dữ liệu 2 cảm biến còn lại
    light_feed.publish(lightValue);
    earth_humid_feed.publish(soilValue);
    Serial.print("[PUB] Anh sang (0-4095): "); Serial.print(lightValue);
    Serial.print(" | Do am dat (0-4095): "); Serial.println(soilValue);

    lastSendTime = millis(); // Reset bộ đếm thời gian
  }
}


/*
 * ==========================================================
 * PHẦN 4: HÀM TIỆN ÍCH - KẾT NỐI MQTT
 * ==========================================================
 */
void MQTT_connect() {
  if (mqtt.connected()) {
    return; // Đã kết nối, không làm gì cả
  }

  Serial.print("Dang ket noi MQTT (Adafruit IO)...");
  int8_t ret;
  while ((ret = mqtt.connect()) != 0) {
     Serial.println(mqtt.connectErrorString(ret));
     Serial.println("Thu lai sau 5 giay...");
     mqtt.disconnect();
     delay(5000);
  }
  Serial.println("Da ket noi MQTT!");
}