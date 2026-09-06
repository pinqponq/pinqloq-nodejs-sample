# pinqloq · Node.js Lab

Express ve TypeScript ile çalışan, gerçek `pinqloq` SDK’sını kullanan yerel test paneli. HTTP logları, manuel olaylar, hassas alan maskelemesi ve toplu gönderim tarayıcıdan denenebilir.

## Çalıştırma

Node.js 22 veya üzeri gerekir. Depoya erişim için GitHub yetkisi gerekir.

```sh
git clone https://github.com/pinqponq/pinqloq-nodejs-sample.git
cd pinqloq-nodejs-sample
npm ci
```

`.env.example` dosyasını `.env` adıyla kopyala. PowerShell’de `Copy-Item .env.example .env`; macOS/Linux’ta `cp .env.example .env` kullanabilirsin. `PINQLOQ_SECRET_KEY` değerini sunucuda doldur, ardından:

```sh
npm run dev
```

[Yerel test panelini aç](http://127.0.0.1:3100). Derlenmiş uygulama için `npm run build` ve `npm start` kullan. `PORT` ile port değiştirilebilir. Uygulama yalnızca `127.0.0.1` üzerinde dinler.

## SDK import’u ve geçici paket kaynağı

Uygulama SDK’yı normal paket adıyla kullanır:

```ts
import { createPinqloq } from 'pinqloq';
```

SDK henüz npm’de yayımlanmadığı için `package.json`, depoda bulunan `packages/pinqloq-53c7cfa.tgz` arşivini kullanır. Bu arşiv `vendor/pinqloq-backend` submodule’ünün `53c7cfa6f6d3c09403cced2f432ea4680671fd93` commit’indeki SDK’dan `npm pack` ile üretilmiştir. Arşiv depoda tutulur; `npm ci` için submodule veya backend build’i gerekmez. Başka makinelerde de aynı arşiv ve lockfile kullanılır.

Paketi kaynaktan yeniden üretmek istersen:

```sh
npm run setup:sdk
```

Bu komut sabit submodule sürümünü hazırlar, SDK’da `npm ci` ve build çalıştırır, arşivi oluşturur ve sample’a kurar. Kurulum script’i Node üzerinden npm CLI’ı çağırır; Windows’ta boşluk içeren yollar desteklenir. Paket güncellenirken arşiv ile `package-lock.json` birlikte güncellenmelidir.

PR merge edildikten **ve paket npm’de yayımlandıktan sonra**, yayımlanan sürümü `npm install --save-exact pinqloq@<sürüm>` ile kur. Ardından geçici SDK arşivi, `setup:sdk` script’i ve yalnızca `vendor/pinqloq-backend` submodule’ü kaldırılabilir. `.pinq-doq` standartlar submodule’ü kalır. Uygulama import’larında değişiklik gerekmez.

## Panel ve collection ayarları

Bu sample için mevcut **nodejs test** projesi kullanılabilir:

| Değişken | Değer |
| --- | --- |
| `PINQLOQ_SECRET_KEY` | Projenin secret key’i; yalnızca `.env` / sunucu ortamında |
| `PINQLOQ_HTTP_COLLECTION` | `pinqloq_node_test_http` |
| `PINQLOQ_MANUAL_COLLECTION` | `pinqloq_node_test_manual` |

Yeni kurulumda [dashboard](https://pinqloq.pinqponq.io) üzerinden proje ve bu iki collection’ı oluştur. Proje secret key’ini `.env` içine koy. Panel erişimin yoksa Team Members → kendi admin/owner hesabın → Edit bölümünden en az 8 karakterlik panel şifresi belirle.

[Log panelinde](https://pinqloq-panel.pinqponq.io) ilgili collection’ı seç ve sample ekranındaki `testRun` / correlation ID değerini `deviceIdentifier` veya metadata filtresiyle ara. Mevcut test projesi, collection’lar ve panel hesabı zaten hazırsa tekrar oluşturulmaları gerekmez.

## Test senaryoları

- **HTTP:** 200, 400, 401, 404 veya 500 üreten yerel Express endpoint’i. Middleware otomatik loglar; 4xx Warning, 5xx Error olur. Bunlar test uygulamasının yanıt kodlarıdır; ingest API yanıtları ayrı ölçülür.
- **Manuel:** Debug, Information, Warning, Error veya Fatal backend olayı. Callback sonuçları test kaydında `manualSent` / `manualFailed` alanlarında bulunur.
- **Maskeleme:** Sahte `password` ve `accessToken` yerleşik kuralla; `taxNumber` özel `redactFields` ayarıyla maskelenir. Ayrı endpoint `redactPaths` ile tamamen maskelenir. Sonucu log panelindeki detaylardan incele.
- **Yük:** 100 veya 1.000 toplam log. Yarısı HTTP, yarısı manuel; statüler ve seviyeler eşit dağılır. 10 eşzamanlı yerel istek, üretim grupları arasında 100 ms bekleme. Aynı anda tek test çalışır.
- **Durdur:** Yeni üretimi durdurur. Devam eden yerel istekler ve SDK kuyruğundaki kayıtlar gönderilmeye devam eder. Ctrl+C uygulamayı aynı sırayla kapatır.

UI, statik dosyalar, test yönetimi ve sağlık sorguları loglanmaz. SDK middleware’i yalnızca dahili senaryo endpoint’lerine uygulanır. Dışarıdan keyfi gövdeler bu endpoint’lere gönderilemez; testleri `/api/runs` üzerinden başlat. Loglar yalnızca sahte veriler içerir. Secret key ne tarayıcıya ne test raporlarına aktarılır.

## Kuyruk ve ölçüm

```text
enqueue → SDK bellek kuyruğu → 200 kayıt veya 2 saniye
        → { collectionName, logs: [...] } → Ingest API → RabbitMQ → Worker → Panel
```

SDK kuyruğu 10.000 kayıttır. RabbitMQ bağlantısı sample’da veya SDK paketinde değildir; ingest sunucusu tarafındadır. Sample kuyruk davranışını değiştirmez. Tek bir SDK örneği kullanır.

`src/delivery.ts` yalnızca bu sample sürecindeki ingest `fetch` çağrılarını gözlemler. Gönderim zamanı, collection, batch boyutu, HTTP durumu, süre ve `acceptedCount` tutulur; gövde ve kimlik bilgileri tutulmaz. Gözlemci kapanışta kaldırılır. Aynı süreç içinde birden fazla sample örneği çalıştırılması hedeflenmez.

Collection’lar ayrı HTTP istekleriyle gönderildiğinden 200 log iki collection’a aitse iki istek çıkabilir. Test sonundaki küçük batch ve kapanışta erken flush normaldir. Sample başarıyı yalnızca HTTP 200 veya SDK `onSent` callback’iyle ölçmez: API’nin `acceptedCount` değerini de kontrol eder. Eksik veya bilinmeyen kabul sayısı başarılı olarak gösterilmez. API kabulü panelde işlendiği garantisi değildir.

Son 30 test bellekte tutulur; uygulama yeniden başlayınca silinir. `/health` yanıtındaki `ingest.isConnected`, ilk gönderim öncesinde `null`; bir HTTP yanıtı alındığında `true`; ağ hatasında `false` olur. 401/403 yanıtı bağlantı olduğunu ama yetkinin başarısız olduğunu gösterir.

## Komut satırından test

Sunucu çalışırken:

```sh
npm run load -- 100
npm run load -- 1000
npm run test:live
```

`test:live`, 1 HTTP hata örneği, 1 manuel hata ve 1.000 logluk test çalıştırır; gerçek servise **1.002 log** gönderir. Sonuç ve test kimliklerini terminalde gösterir. Farklı yerel port için `SAMPLE_URL` ortam değişkenini ayarla.

curl/Postman örneği:

```sh
curl -X POST http://127.0.0.1:3100/api/runs -H "Content-Type: application/json" -d '{"kind":"http","status":500}'
```

`GET /api/runs/<id>` durum raporunu getirir. `POST /api/runs/<id>/stop` yeni üretimi durdurur. Başka test aktifken başlatma isteği 409 döner.

## Geliştirme ve doğrulama

```sh
npm run typecheck
npm test
npm run build
```

Otomatik testler dış ingest isteklerini taklit eder; gerçek servise log göndermez. Collection dağılımı, batch sayısı, maskeleme, yanlış konfigürasyon, tek aktif test, durdurma, kapanış, HTTP reddi ve kısmi kabul doğrulanır. CI aynı kontrolleri Windows ve Linux üzerinde çalıştırır.

Ortak standartlar `.pinq-doq` submodule’ünden `.claude/rules/` ve `.claude/skills/` altına kopyalanır. `.claude/.pinq-doq-version` kaynak commit’ini kaydeder. Güncelleme için `.pinq-doq/tasks/update.md` yönergelerini izle. TypeScript sample koduna ortak `common.md` kuralları uygulanır.
