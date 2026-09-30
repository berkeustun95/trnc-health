# ADA · KITOB üye otel listesi · şablon açıklaması

Ekteki `kitob-otel-listesi-sablon.csv` dosyasında her satır bir otel içindir. İlk satırdaki sütun başlıklarını lütfen değiştirmeyin.

## Sütunlar

| Sütun | Zorunlu | Açıklama | Örnek |
|---|---|---|---|
| `uye_no` | Tercihen | KITOB üyelik numarası. Bir oteli sonraki listelerde de tanımamızı sağlar; ad değişse bile otel aynı kalır. | `127` |
| `otel_adi` | **Evet** | Otelin tam adı | `Örnek Palace Hotel` |
| `sinif` | **Evet** | Aşağıdaki 10 sınıftan biri, yazıldığı gibi | `4 Yıldız` |
| `ilce` | **Evet** | Lefkoşa, Girne, Gazimağusa, Güzelyurt, İskele, Lefke veya Karpaz | `Girne` |
| `adres` | Hayır | Açık adres | `Karaoğlanoğlu Cad. No: 12` |
| `telefon` | Hayır | Resepsiyon numarası. Birden fazla numara varsa ilki kullanılır. | `0392 815 12 34` |
| `eposta` | Hayır | Rezervasyon veya genel e-posta adresi | `info@ornekotel.com` |
| `web_sitesi` | Hayır | Otelin web sitesi | `www.ornekotel.com` |
| `enlem` | Hayır | Konumun enlemi (Google Haritalar'da otele sağ tıklayınca çıkan ilk sayı) | `35.3364` |
| `boylam` | Hayır | Konumun boylamı (ikinci sayı) | `33.3190` |

**Sınıflar:** 5 Yıldız · 4 Yıldız · 3 Yıldız · 2 Yıldız · 1 Yıldız · Bungalow · Tatil Köyü · Butik Otel · Özel Sertifikalı · Apart Otel

## Dosyayı kaydetme

- Excel'de: **Dosya → Farklı Kaydet → "CSV UTF-8 (virgülle ayrılmış)"**. Bu şekilde Türkçe karakterler (ç, ğ, ı, İ, ö, ş, ü) bozulmadan kalır.
- Lütfen listenin hangi tarih itibarıyla güncel olduğunu e-postanızda belirtin. Bu tarih uygulamada listenin güncelliğini takip etmek için kullanılır.
- Listeden çıkarılan oteller uygulamada gösterilmez.

Teşekkür ederiz. ADA · Kuzey Kıbrıs Asistanı
