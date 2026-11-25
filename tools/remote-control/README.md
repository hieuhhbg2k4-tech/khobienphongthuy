# Điều Khiển Máy Tính Bằng Điện Thoại Qua Chrome

Ứng dụng web chạy cục bộ trên mạng Wi-Fi (LAN) giúp điều khiển chuột, bàn phím (hỗ trợ gõ Tiếng Việt có dấu), xem màn hình trực tiếp, âm lượng, media và hệ thống Windows ngay trên trình duyệt Chrome của điện thoại.

## Cách chạy

1. Chạy file `start.bat` (hoặc chạy lệnh `python server.py --open-host` trong thư mục `remote-control`).
2. Trình duyệt trên máy tính sẽ mở trang `http://127.0.0.1:8765/host` hiển thị **Link LAN** và **Mã PIN 6 số**.
3. Đảm bảo điện thoại và máy tính kết nối **cùng mạng Wi-Fi**.
4. Mở **Chrome trên điện thoại**, nhập Link LAN (ví dụ `http://192.168.1.15:8765`) và nhập mã PIN 6 số.

> **Mẹo:** Trên Chrome điện thoại, bấm menu `⋮` → **Thêm vào màn hình chính** để dùng toàn màn hình như ứng dụng riêng.

## Các tính năng chính

- **Chuột (Trackpad):** Di chuột 1 ngón, chạm để click, chạm 2 ngón chuột phải, vuốt 2 ngón cuộn trang, nút giữ kéo (Drag Lock), chỉnh độ nhạy.
- **Màn hình trực tiếp:** Truyền hình ảnh màn hình PC theo thời gian thực qua WebSocket, chạm trực tiếp để click, nhấn giữ để chuột phải, kéo để kéo thả, phóng to 1.8x.
- **Bàn phím & Phím tắt:** Gõ Tiếng Việt có dấu (Unicode `SendInput`), gõ trực tiếp, phím tắt (`Alt+Tab`, `Ctrl+C`, `Ctrl+V`, `Win`, mũi tên...), đồng bộ Clipboard hai chiều.
- **Hệ thống & Media:** Tăng/giảm âm lượng, Phát/Dừng nhạc, mở link trực tiếp trên Chrome máy tính, chụp ảnh màn hình tải về điện thoại, khóa máy, Sleep/Restart/Shutdown.

## Nếu điện thoại không truy cập được

Mở PowerShell với quyền Administrator và cho phép cổng `8765` qua Windows Firewall:

```powershell
New-NetFirewallRule -DisplayName "PC Remote Control" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow
```

