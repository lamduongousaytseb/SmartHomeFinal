import joblib
import pandas as pd
import os  # <-- THÊM DÒNG NÀY

# --- SỬA CÁC ĐƯỜNG DẪN TẢI FILE ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(SCRIPT_DIR, "models/model_rf.pkl")
SCALER_PATH = os.path.join(SCRIPT_DIR, "models/scaler.pkl")
MEANS_PATH = os.path.join(SCRIPT_DIR, "models/column_means.pkl")
ORDER_PATH = os.path.join(SCRIPT_DIR, "models/column_order.pkl")

# Tải file bằng đường dẫn tuyệt đối mới
try:
    model = joblib.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
    column_means = joblib.load(MEANS_PATH)
    column_order = joblib.load(ORDER_PATH)
except FileNotFoundError as e:
    print(f"LỖI: Không tìm thấy file mô hình tại: {e.filename}")
    exit()
def predict_led_on(partial_input: dict) -> str:
    full_input = column_means.copy()
    full_input.update(partial_input)

    ordered_input = full_input[column_order]

    input_scaled = scaler.transform(pd.DataFrame([ordered_input]))
    prediction = model.predict(input_scaled)[0]

    return "BẬT" if prediction == 1 else "TẮT"

input_data = {
    "Light_Intensity": 500,
    "Temperature": 21.5,
    "Humidity": 67,
    "Minute_Of_Day": 510  # 8:30 sáng
}

result = predict_led_on(input_data)
print(f"Kết quả dự đoán LED: {result}")
