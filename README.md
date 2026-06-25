<p align="center">
  <img src="media/codecrew.svg" width="96" alt="CodeCrew logo">
</p>

<h1 align="center">CodeCrew</h1>

<p align="center">
  Güvenli, ücretsiz model öncelikli AI kod değişiklikleri için VS Code eklentisi.
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.3.0-2563eb">
  <img alt="Tests" src="https://img.shields.io/badge/tests-96%20passing-16a34a">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-0f172a">
  <img alt="VS Code" src="https://img.shields.io/badge/VS%20Code-%5E1.95.0-007acc">
</p>

CodeCrew, AI tarafından önerilen değişiklikleri doğrudan dosyalarınıza yazmaz. Önce küçük bir Search/Replace yaması üretir, değişikliği sanal içerik üzerinde hazırlar ve VS Code'un yerleşik diff ekranında incelemenize sunar. Dosyalar yalnızca açık onayınızdan sonra değiştirilir.

## Öne çıkan özellikler

- Ücretsiz modelleri önce deneyen çoklu sağlayıcı yönlendirmesi
- Sağlayıcı veya model başarısız olduğunda güvenli otomatik geçiş
- Yazmadan önce yerel diff ve açık kullanıcı onayı
- Son AI değişikliğini güvenli biçimde geri alma
- Değişen dosya, çakışma ve korunan dosya kontrolleri
- Geçersiz AI yamalarını reddetme ve daha küçük yama ile tekrar deneme
- Ücretli modeller için her istekte ayrı onay
- API anahtarlarını yalnızca VS Code Secret Storage içinde saklama
- Sağlayıcı bağlantı durumu ve model ayarları ekranları

## Desteklenen sağlayıcılar

| Sağlayıcı | Kimlik bilgisi |
| --- | --- |
| OpenRouter | API key |
| Google Gemini | API key |
| Cerebras | API key |
| Groq | API key |
| GitHub Models | GitHub token |
| Mistral | API key |
| Cloudflare Workers AI | Account ID + API token |
| Hugging Face | Access token |

Bir sağlayıcı yapılandırılmamışsa CodeCrew onu sessizce atlar. En az bir sağlayıcı anahtarı eklenmelidir.

## Kurulum

### Hazır VSIX paketinden

1. En son `codecrew-*.vsix` dosyasını GitHub Releases sayfasından indirin.
2. VS Code'da Extensions görünümünü açın.
3. Sağ üstteki `...` menüsünden **Install from VSIX...** seçeneğine basın.
4. İndirdiğiniz VSIX dosyasını seçin.
5. Gerekirse VS Code penceresini yeniden yükleyin.

Komut satırından kurulum:

```sh
code --install-extension codecrew-0.3.0.vsix
```

### Kaynak koddan geliştirme

Gereksinimler:

- Node.js 20 veya üzeri
- npm
- VS Code 1.95 veya üzeri

```sh
git clone https://github.com/orhanucok/CodeCrew.git
cd CodeCrew
npm install
npm test
```

Projeyi VS Code ile açıp `F5` tuşuna basarak Extension Development Host başlatabilirsiniz.

## İlk ayar

1. VS Code'da `Ctrl+Shift+P` tuşlarına basın.
2. **CodeCrew: Advanced Settings — Providers** komutunu çalıştırın.
3. Kullanmak istediğiniz sağlayıcı için **Add API key** seçeneğine basın.
4. **Test connection** ile bağlantıyı kontrol edin.

Model tercihlerini değiştirmek için **CodeCrew: Advanced Settings — Models** komutunu kullanın.

> API anahtarları proje dosyalarına, ayarlara veya webview içine yazılmaz. Yalnızca VS Code Secret Storage kullanılır.

## Kullanım

Editörde kod seçin, sağ tıklayın ve aşağıdaki komutlardan birini çalıştırın:

- **CodeCrew: Fix this**
- **CodeCrew: Explain this**
- **CodeCrew: Improve selected code**
- **CodeCrew: Add types**
- **CodeCrew: Write tests**

Kod değiştiren işlemlerde CodeCrew:

1. Projeyi ve seçili kodu inceler.
2. Uygun ücretsiz sağlayıcı/modeli seçer.
3. Yamayı gerçek dosyaya dokunmadan hazırlar.
4. VS Code diff ekranını gösterir.
5. Yalnızca **Apply** onayından sonra dosyayı değiştirir.
6. Güvenli geri alma için checkpoint oluşturur.

Son değişikliği geri almak için **CodeCrew: Undo Last AI Change** komutunu kullanın.

## Ücretli model güvenliği

Ücretli fallback varsayılan olarak kapalıdır. Açılmış olsa bile CodeCrew, ücretli bir modeli çağırmadan önce her istek için ayrı onay ister. İptal edilen bir onay hiçbir ücretli çağrı üretmez.

## Güvenlik yaklaşımı

- `.env`, anahtar, sertifika ve benzeri hassas dosyalara yama uygulanmaz.
- Yama önce sanal içerik üzerinde doğrulanır.
- Dosya siz diff ekranını incelerken değişirse işlem durdurulur.
- Kısmi yazma hatalarında dosyalar önceki durumuna döndürülür.
- Model sağlık kontrollerine proje kodu gönderilmez.
- API anahtarları loglanmaz ve webview tarafına aktarılmaz.

Açık bildirmek için [SECURITY.md](SECURITY.md) dosyasındaki özel bildirim sürecini kullanın.

## Geliştirme komutları

```sh
npm install
npm run compile
npm test
npm run package
```

`npm run package`, testleri çalıştırır ve kök dizinde kurulabilir bir VSIX üretir.

## Proje yapısı

```text
CodeCrew/
├─ media/                  # Eklenti görselleri
├─ packaging/              # VSIX manifest dosyaları
├─ scripts/                # Paketleme araçları
├─ src/
│  ├─ core/                # Güvenlik, yama ve yönlendirme katmanı
│  │  └─ providers/        # AI sağlayıcı adaptörleri
│  ├─ prompts/             # Görev istemleri
│  ├─ test/                # Otomatik testler
│  ├─ types/               # TypeScript tipleri
│  └─ extension.ts         # Eklenti giriş noktası
├─ package.json
└─ tsconfig.json
```

## Testler

Projede yama ayrıştırma, sanal uygulama, rollback, checkpoint, diff onayı, sağlayıcı fallback'i ve ücretli model onayını kapsayan 96 otomatik test bulunur.

```sh
npm test
```

## Katkıda bulunma

Hata düzeltmeleri ve geliştirmeler memnuniyetle karşılanır. Başlamadan önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını okuyun.

## Lisans

Bu proje [MIT Lisansı](LICENSE) altında yayımlanır.
