"""
Test koneksi Telegram Bot
Jalankan: python3 test_telegram.py
"""
import os, requests, json

TOKEN   = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

if not TOKEN:
    print("❌ TELEGRAM_BOT_TOKEN belum diisi di Secrets")
    exit(1)

print(f"🔍 Mengecek token: {TOKEN[:20]}...")

# 1. Cek token valid
r = requests.get(f"https://api.telegram.org/bot{TOKEN}/getMe", timeout=10)
data = r.json()

if not data.get("ok"):
    print(f"\n❌ TOKEN TIDAK VALID!")
    print(f"   Error: {data.get('description')}")
    print(f"\n👉 Cara dapat token baru:")
    print(f"   1. Buka Telegram → cari @BotFather")
    print(f"   2. Ketik /mybots → pilih bot Anda")
    print(f"   3. Klik 'API Token' → salin token lengkap")
    print(f"   4. Update Secret TELEGRAM_BOT_TOKEN di Replit")
    exit(1)

bot = data["result"]
print(f"\n✅ Token valid!")
print(f"   Bot name : {bot['first_name']}")
print(f"   Username : @{bot['username']}")
print(f"   Bot ID   : {bot['id']}")

# 2. Ambil Chat ID dari update terbaru
print(f"\n🔍 Mengambil Chat ID dari update terbaru...")
r2 = requests.get(f"https://api.telegram.org/bot{TOKEN}/getUpdates?offset=-5", timeout=10)
updates = r2.json().get("result", [])

if updates:
    latest = updates[-1]
    msg = latest.get("message") or latest.get("callback_query", {}).get("message", {})
    if msg:
        chat = msg.get("chat", {})
        real_id   = chat.get("id")
        real_name = chat.get("first_name","") + " " + chat.get("username","")
        print(f"\n✅ Chat ID ditemukan: {real_id}")
        print(f"   Nama: {real_name.strip()}")
        if str(real_id) != str(CHAT_ID):
            print(f"\n⚠️  PERHATIAN: Chat ID di Secret ({CHAT_ID}) berbeda!")
            print(f"   Gunakan: {real_id}")
    else:
        print("⚠️  Ada update tapi tidak ada pesan.")
else:
    print("⚠️  Belum ada update. Kirim /start dulu ke bot Anda di Telegram.")
    if CHAT_ID:
        print(f"   Chat ID di Secret: {CHAT_ID}")

# 3. Coba kirim pesan test
if CHAT_ID:
    print(f"\n🔍 Mencoba kirim pesan test ke Chat ID {CHAT_ID}...")
    r3 = requests.post(
        f"https://api.telegram.org/bot{TOKEN}/sendMessage",
        json={"chat_id": CHAT_ID, "text": "✅ Trading Bot terhubung! Bot siap menerima sinyal."},
        timeout=10
    )
    res = r3.json()
    if res.get("ok"):
        print(f"✅ Pesan test berhasil dikirim! Cek Telegram Anda.")
    else:
        print(f"❌ Gagal kirim pesan: {res.get('description')}")
        if "chat not found" in str(res.get('description','')).lower():
            print(f"   → Chat ID salah. Kirim /start dulu ke @{bot['username']} di Telegram")
        if "bot was blocked" in str(res.get('description','')).lower():
            print(f"   → Bot diblokir oleh user. Buka Telegram → unblock bot")
else:
    print("\n⚠️  TELEGRAM_CHAT_ID belum diisi di Secrets")
