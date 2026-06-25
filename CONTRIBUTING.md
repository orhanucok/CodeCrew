# CodeCrew'a katkıda bulunma

Katkınız için teşekkürler.

## Geliştirme ortamı

```sh
npm install
npm test
```

VS Code'da projeyi açın ve `F5` ile Extension Development Host başlatın.

## Değişiklik gönderme

1. Depoyu fork edin ve değişikliğiniz için yeni bir branch oluşturun.
2. Değişikliği mümkün olduğunca küçük ve tek amaçlı tutun.
3. Yeni davranış için test ekleyin veya mevcut testi güncelleyin.
4. `npm test` komutunun başarılı olduğunu doğrulayın.
5. Pull request içinde problemi, çözümü ve kullanıcıya etkisini açıklayın.

## Güvenlik kuralları

- API anahtarlarını kaynak koda, teste, fixture'a veya ekran görüntüsüne eklemeyin.
- Kullanıcı onayı olmadan gerçek dosyalara yazan davranış eklemeyin.
- Korunan dosya, rollback, checkpoint ve ücretli model onayı kontrollerini atlamayın.
- Sağlayıcı sağlık kontrollerine proje kodu göndermeyin.

## Kod stili

- Mevcut TypeScript yapısını ve dosya adlandırmasını takip edin.
- Sağlayıcıya özel davranışı ilgili adaptörde tutun.
- Kullanıcıya gösterilen hata mesajlarında API yanıtı veya gizli bilgi sızdırmayın.
