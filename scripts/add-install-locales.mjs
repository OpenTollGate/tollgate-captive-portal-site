#!/usr/bin/env node
// Add the install-panel keys to every guest locale catalogue.
//
// The repo's `tests/unit/locales-all-keys.test.js` is a strict parity gate: every
// catalogue must carry exactly the same key set as `en.json`. So a new English
// string is not "translated later" — it either lands in all 14 catalogues in the
// same change, or the suite is red.
//
// This is an idempotent migration helper, not a runtime dependency: it merges the
// keys below into each non-English catalogue, preserving the existing key order
// and appending the new ones before the closing brace. Re-running it is a no-op.
//
// The translations are deliberately plain, formal-neutral register, matching the
// existing catalogues (which use e.g. German "Sie", Japanese です/ます). They are
// machine-drafted and SHOULD be reviewed by a native speaker before a public
// release — noted in the PR body rather than pretended otherwise.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(scriptsDir, '..');
const localesDir = path.join(repo, 'public', 'locales');

/** The key set this migration introduces, with per-locale values. */
const TRANSLATIONS = {
  de: {
    install_signpost_title: 'Speichern Sie dieses Portal auf Ihrem Startbildschirm',
    install_signpost_unavailable:
      'Ihr Browser kann diese Seite nicht direkt installieren – sie wird über eine unverschlüsselte Verbindung ausgeliefert, und Browser erlauben installierbare Apps nur über HTTPS. Fügen Sie sie stattdessen wie unten beschrieben zum Startbildschirm hinzu.',
    install_signpost_manual_ios: 'Tippen Sie auf „Teilen“ und wählen Sie „Zum Home-Bildschirm“.',
    install_signpost_manual_android:
      'Öffnen Sie das Browsermenü (⋮) und wählen Sie „Zum Startbildschirm hinzufügen“.',
    install_signpost_manual_desktop:
      'Nutzen Sie das Browsermenü, um diese Seite als App anzuheften oder zu installieren.',
    install_app_title: 'Ihr Internetzugang mit einem Tippen entfernt',
    install_app_body:
      'Fügen Sie TollGate Ihrem Startbildschirm hinzu. Die App öffnet direkt Ihr Guthaben und die Aufladung, ohne dass Sie das Portal bei jeder Verbindung suchen müssen.',
    install_app_cta: 'Zum Startbildschirm hinzufügen',
    install_app_later: 'Nicht jetzt',
    install_app_note_no_custody:
      'Ihr Wallet bleibt auf diesem Gerät. Die App ist eine Verknüpfung zum Portal dieses Netzwerks – kein Ort, an dem Ihr Guthaben verwahrt wird.',
    low_security_notice_title: 'Diese Verbindung ist nicht verschlüsselt',
    low_security_notice_body:
      'Dieses Portal wird nicht über HTTPS ausgeliefert. Geben Sie hier keine Seed-Phrase und kein Passwort ein.',
  },
  es: {
    install_signpost_title: 'Guarda este portal en tu pantalla de inicio',
    install_signpost_unavailable:
      'Tu navegador no puede instalar esta página directamente: se sirve por una conexión sin cifrar, y los navegadores solo permiten instalar aplicaciones por HTTPS. Sigue los pasos de abajo para añadirla a la pantalla de inicio.',
    install_signpost_manual_ios: 'Toca Compartir y elige «Añadir a pantalla de inicio».',
    install_signpost_manual_android:
      'Abre el menú del navegador (⋮) y elige «Añadir a pantalla de inicio».',
    install_signpost_manual_desktop:
      'Usa el menú del navegador para fijar o instalar esta página como aplicación.',
    install_app_title: 'Tu acceso a internet a un toque',
    install_app_body:
      'Añade TollGate a tu pantalla de inicio. Se abre directamente en tu saldo y recarga, sin tener que buscar el portal cada vez que te conectas.',
    install_app_cta: 'Añadir a pantalla de inicio',
    install_app_later: 'Ahora no',
    install_app_note_no_custody:
      'Tu monedero permanece en este dispositivo. La aplicación es un acceso directo al portal de esta red, no un lugar donde se guarde tu saldo.',
    low_security_notice_title: 'Esta conexión no está cifrada',
    low_security_notice_body:
      'Este portal no se sirve por HTTPS, así que no introduzcas aquí ninguna frase semilla ni contraseña.',
  },
  fr: {
    install_signpost_title: 'Enregistrez ce portail sur votre écran d\u2019accueil',
    install_signpost_unavailable:
      'Votre navigateur ne peut pas installer cette page directement : elle est servie sur une connexion non chiffrée, et les navigateurs ne permettent d\u2019installer des applications qu\u2019en HTTPS. Suivez les étapes ci-dessous pour l\u2019ajouter à votre écran d\u2019accueil.',
    install_signpost_manual_ios:
      'Touchez Partager, puis « Sur l\u2019écran d\u2019accueil ».',
    install_signpost_manual_android:
      'Ouvrez le menu du navigateur (⋮) et choisissez « Ajouter à l\u2019écran d\u2019accueil ».',
    install_signpost_manual_desktop:
      'Utilisez le menu du navigateur pour épingler ou installer cette page comme application.',
    install_app_title: 'Votre accès internet à portée de main',
    install_app_body:
      'Ajoutez TollGate à votre écran d\u2019accueil. L\u2019application ouvre directement votre solde et votre recharge, sans devoir chercher le portail à chaque connexion.',
    install_app_cta: 'Ajouter à l\u2019écran d\u2019accueil',
    install_app_later: 'Plus tard',
    install_app_note_no_custody:
      'Votre portefeuille reste sur cet appareil. L\u2019application est un raccourci vers le portail de ce réseau, pas un endroit où vos fonds sont conservés.',
    low_security_notice_title: 'Cette connexion n\u2019est pas chiffrée',
    low_security_notice_body:
      'Ce portail n\u2019est pas servi en HTTPS : ne saisissez ici ni phrase de récupération ni mot de passe.',
  },
  it: {
    install_signpost_title: 'Salva questo portale sulla schermata Home',
    install_signpost_unavailable:
      'Il browser non può installare questa pagina direttamente: viene servita su una connessione non cifrata e i browser consentono di installare app solo su HTTPS. Segui i passaggi qui sotto per aggiungerla alla schermata Home.',
    install_signpost_manual_ios: 'Tocca Condividi, quindi «Aggiungi alla schermata Home».',
    install_signpost_manual_android:
      'Apri il menu del browser (⋮) e scegli «Aggiungi a schermata Home».',
    install_signpost_manual_desktop:
      'Usa il menu del browser per aggiungere o installare questa pagina come app.',
    install_app_title: 'Il tuo accesso a internet a portata di tocco',
    install_app_body:
      'Aggiungi TollGate alla schermata Home. Si apre direttamente sul saldo e sulla ricarica, senza dover cercare il portale ogni volta che ti connetti.',
    install_app_cta: 'Aggiungi alla schermata Home',
    install_app_later: 'Non ora',
    install_app_note_no_custody:
      'Il tuo portafoglio resta su questo dispositivo. L\u2019app è una scorciatoia verso il portale di questa rete, non un luogo in cui vengono custoditi i tuoi fondi.',
    low_security_notice_title: 'Questa connessione non è cifrata',
    low_security_notice_body:
      'Questo portale non viene servito in HTTPS: non inserire qui frasi di recupero o password.',
  },
  pt: {
    install_signpost_title: 'Guarde este portal no ecrã inicial',
    install_signpost_unavailable:
      'O seu navegador não consegue instalar esta página diretamente — é servida por uma ligação não encriptada, e os navegadores só permitem instalar aplicações por HTTPS. Siga os passos abaixo para a adicionar ao ecrã inicial.',
    install_signpost_manual_ios: 'Toque em Partilhar e escolha «Adicionar ao ecrã inicial».',
    install_signpost_manual_android:
      'Abra o menu do navegador (⋮) e escolha «Adicionar ao ecrã inicial».',
    install_signpost_manual_desktop:
      'Use o menu do navegador para fixar ou instalar esta página como aplicação.',
    install_app_title: 'O seu acesso à internet a um toque',
    install_app_body:
      'Adicione o TollGate ao ecrã inicial. Abre diretamente no seu saldo e carregamento, sem ter de procurar o portal sempre que se liga.',
    install_app_cta: 'Adicionar ao ecrã inicial',
    install_app_later: 'Agora não',
    install_app_note_no_custody:
      'A sua carteira fica neste dispositivo. A aplicação é um atalho para o portal desta rede, não um local onde os seus fundos são guardados.',
    low_security_notice_title: 'Esta ligação não está encriptada',
    low_security_notice_body:
      'Este portal não é servido por HTTPS, por isso não introduza aqui frases de recuperação nem palavras-passe.',
  },
  id: {
    install_signpost_title: 'Simpan portal ini ke layar utama',
    install_signpost_unavailable:
      'Peramban Anda tidak dapat memasang halaman ini secara langsung — halaman ini disajikan melalui koneksi tanpa enkripsi, dan peramban hanya mengizinkan pemasangan aplikasi melalui HTTPS. Ikuti langkah di bawah untuk menambahkannya ke layar utama.',
    install_signpost_manual_ios: 'Ketuk Bagikan, lalu pilih "Tambahkan ke Layar Utama".',
    install_signpost_manual_android:
      'Buka menu peramban (⋮) dan pilih "Tambahkan ke layar utama".',
    install_signpost_manual_desktop:
      'Gunakan menu peramban untuk menyematkan atau memasang halaman ini sebagai aplikasi.',
    install_app_title: 'Akses internet Anda hanya dengan satu ketukan',
    install_app_body:
      'Tambahkan TollGate ke layar utama. Aplikasi langsung membuka saldo dan isi ulang Anda, tanpa perlu mencari portal setiap kali terhubung.',
    install_app_cta: 'Tambahkan ke layar utama',
    install_app_later: 'Nanti saja',
    install_app_note_no_custody:
      'Dompet Anda tetap di perangkat ini. Aplikasi ini adalah pintasan ke portal jaringan ini, bukan tempat dana Anda disimpan.',
    low_security_notice_title: 'Koneksi ini tidak terenkripsi',
    low_security_notice_body:
      'Portal ini tidak disajikan melalui HTTPS, jadi jangan masukkan frasa pemulihan atau kata sandi apa pun di sini.',
  },
  ru: {
    install_signpost_title: 'Сохраните этот портал на главном экране',
    install_signpost_unavailable:
      'Ваш браузер не может установить эту страницу напрямую: она открывается по незашифрованному соединению, а браузеры разрешают устанавливать приложения только по HTTPS. Добавьте её на главный экран, как описано ниже.',
    install_signpost_manual_ios: 'Нажмите «Поделиться» и выберите «На экран «Домой»».',
    install_signpost_manual_android:
      'Откройте меню браузера (⋮) и выберите «Добавить на главный экран».',
    install_signpost_manual_desktop:
      'Используйте меню браузера, чтобы закрепить или установить эту страницу как приложение.',
    install_app_title: 'Доступ в интернет в одно касание',
    install_app_body:
      'Добавьте TollGate на главный экран. Приложение сразу открывает баланс и пополнение — искать портал при каждом подключении больше не нужно.',
    install_app_cta: 'Добавить на главный экран',
    install_app_later: 'Не сейчас',
    install_app_note_no_custody:
      'Ваш кошелёк остаётся на этом устройстве. Приложение — это ярлык к порталу этой сети, а не место хранения ваших средств.',
    low_security_notice_title: 'Это соединение не зашифровано',
    low_security_notice_body:
      'Этот портал открывается не по HTTPS, поэтому не вводите здесь ни сид-фразу, ни пароль.',
  },
  tr: {
    install_signpost_title: 'Bu portalı ana ekranınıza kaydedin',
    install_signpost_unavailable:
      'Tarayıcınız bu sayfayı doğrudan yükleyemiyor — sayfa şifrelenmemiş bir bağlantı üzerinden sunuluyor ve tarayıcılar yüklenebilir uygulamalara yalnızca HTTPS üzerinden izin verir. Ana ekranınıza eklemek için aşağıdaki adımları izleyin.',
    install_signpost_manual_ios: 'Paylaş\'a dokunun ve "Ana Ekrana Ekle"yi seçin.',
    install_signpost_manual_android:
      'Tarayıcı menüsünü (⋮) açın ve "Ana ekrana ekle"yi seçin.',
    install_signpost_manual_desktop:
      'Bu sayfayı uygulama olarak sabitlemek veya yüklemek için tarayıcı menüsünü kullanın.',
    install_app_title: 'İnternet erişiminiz bir dokunuş uzağınızda',
    install_app_body:
      'TollGate\'i ana ekranınıza ekleyin. Her bağlandığınızda portalı aramadan doğrudan bakiyenize ve yüklemenize açılır.',
    install_app_cta: 'Ana ekrana ekle',
    install_app_later: 'Şimdi değil',
    install_app_note_no_custody:
      'Cüzdanınız bu cihazda kalır. Uygulama bu ağın portalına bir kısayoldur; bakiyenizin saklandığı bir yer değildir.',
    low_security_notice_title: 'Bu bağlantı şifrelenmemiş',
    low_security_notice_body:
      'Bu portal HTTPS üzerinden sunulmuyor; buraya kurtarma ifadesi veya şifre girmeyin.',
  },
  vi: {
    install_signpost_title: 'Lưu cổng này vào màn hình chính',
    install_signpost_unavailable:
      'Trình duyệt của bạn không thể cài đặt trực tiếp trang này — trang được phục vụ qua kết nối không mã hóa, và trình duyệt chỉ cho phép cài đặt ứng dụng qua HTTPS. Hãy làm theo các bước bên dưới để thêm trang vào màn hình chính.',
    install_signpost_manual_ios: 'Nhấn Chia sẻ, rồi chọn "Thêm vào MH chính".',
    install_signpost_manual_android:
      'Mở menu trình duyệt (⋮) và chọn "Thêm vào màn hình chính".',
    install_signpost_manual_desktop:
      'Dùng menu trình duyệt để ghim hoặc cài đặt trang này như một ứng dụng.',
    install_app_title: 'Truy cập internet của bạn chỉ cách một lần chạm',
    install_app_body:
      'Thêm TollGate vào màn hình chính. Ứng dụng mở thẳng vào số dư và nạp tiền của bạn, không cần tìm lại cổng mỗi lần kết nối.',
    install_app_cta: 'Thêm vào màn hình chính',
    install_app_later: 'Để sau',
    install_app_note_no_custody:
      'Ví của bạn vẫn ở trên thiết bị này. Ứng dụng chỉ là lối tắt đến cổng của mạng này, không phải nơi lưu giữ tiền của bạn.',
    low_security_notice_title: 'Kết nối này không được mã hóa',
    low_security_notice_body:
      'Cổng này không được phục vụ qua HTTPS, vì vậy đừng nhập cụm từ khôi phục hay mật khẩu nào ở đây.',
  },
  ja: {
    install_signpost_title: 'このポータルをホーム画面に保存',
    install_signpost_unavailable:
      'このページはブラウザから直接インストールできません。暗号化されていない接続で配信されており、ブラウザは HTTPS 経由のアプリのみインストールを許可します。以下の手順でホーム画面に追加してください。',
    install_signpost_manual_ios: '「共有」をタップし、「ホーム画面に追加」を選択します。',
    install_signpost_manual_android:
      'ブラウザのメニュー（⋮）を開き、「ホーム画面に追加」を選択します。',
    install_signpost_manual_desktop:
      'ブラウザのメニューから、このページをアプリとしてピン留めまたはインストールします。',
    install_app_title: 'インターネットへのアクセスをワンタップで',
    install_app_body:
      'TollGate をホーム画面に追加します。接続のたびにポータルを探すことなく、残高とチャージ画面が直接開きます。',
    install_app_cta: 'ホーム画面に追加',
    install_app_later: '後で',
    install_app_note_no_custody:
      'ウォレットはこの端末に残ります。アプリはこのネットワークのポータルへのショートカットであり、資金を保管する場所ではありません。',
    low_security_notice_title: 'この接続は暗号化されていません',
    low_security_notice_body:
      'このポータルは HTTPS で配信されていません。シードフレーズやパスワードはここに入力しないでください。',
  },
  ar: {
    install_signpost_title: 'احفظ هذه البوابة على الشاشة الرئيسية',
    install_signpost_unavailable:
      'لا يستطيع متصفحك تثبيت هذه الصفحة مباشرة — فهي تُقدَّم عبر اتصال غير مشفّر، والمتصفحات لا تسمح بتثبيت التطبيقات إلا عبر HTTPS. اتبع الخطوات أدناه لإضافتها إلى الشاشة الرئيسية.',
    install_signpost_manual_ios: 'اضغط على «مشاركة» ثم اختر «إضافة إلى الشاشة الرئيسية».',
    install_signpost_manual_android:
      'افتح قائمة المتصفح (⋮) واختر «إضافة إلى الشاشة الرئيسية».',
    install_signpost_manual_desktop:
      'استخدم قائمة المتصفح لتثبيت هذه الصفحة أو تثبيتها كتطبيق.',
    install_app_title: 'وصولك إلى الإنترنت على بُعد نقرة واحدة',
    install_app_body:
      'أضف TollGate إلى شاشتك الرئيسية. يفتح مباشرة على رصيدك وعملية التعبئة، دون البحث عن البوابة في كل مرة تتصل فيها.',
    install_app_cta: 'إضافة إلى الشاشة الرئيسية',
    install_app_later: 'ليس الآن',
    install_app_note_no_custody:
      'تبقى محفظتك على هذا الجهاز. التطبيق اختصار إلى بوابة هذه الشبكة، وليس مكانًا تُحفظ فيه أموالك.',
    low_security_notice_title: 'هذا الاتصال غير مشفّر',
    low_security_notice_body:
      'لا تُقدَّم هذه البوابة عبر HTTPS، لذا لا تُدخل هنا عبارة الاسترداد أو أي كلمة مرور.',
  },
  'zh-Hans': {
    install_signpost_title: '将此门户保存到主屏幕',
    install_signpost_unavailable:
      '您的浏览器无法直接安装此页面——它通过未加密的连接提供，而浏览器仅允许通过 HTTPS 安装应用。请按照以下步骤将其添加到主屏幕。',
    install_signpost_manual_ios: '轻点“共享”，然后选择“添加到主屏幕”。',
    install_signpost_manual_android: '打开浏览器菜单（⋮），然后选择“添加到主屏幕”。',
    install_signpost_manual_desktop: '使用浏览器菜单将此页面固定或安装为应用。',
    install_app_title: '一键直达您的网络接入',
    install_app_body:
      '将 TollGate 添加到主屏幕。它将直接打开您的余额和充值页面，每次连接时无需再寻找门户。',
    install_app_cta: '添加到主屏幕',
    install_app_later: '暂不',
    install_app_note_no_custody:
      '您的钱包保留在本设备上。此应用只是通往该网络门户的快捷方式，并非存放您资金的地方。',
    low_security_notice_title: '此连接未加密',
    low_security_notice_body: '此门户未通过 HTTPS 提供，请勿在此输入助记词或任何密码。',
  },
  'zh-Hant': {
    install_signpost_title: '將此入口網站儲存到主畫面',
    install_signpost_unavailable:
      '您的瀏覽器無法直接安裝此頁面——它透過未加密的連線提供，而瀏覽器僅允許透過 HTTPS 安裝應用程式。請依照下列步驟將其加入主畫面。',
    install_signpost_manual_ios: '點一下「分享」，然後選擇「加入主畫面」。',
    install_signpost_manual_android: '開啟瀏覽器選單（⋮），然後選擇「加入主畫面」。',
    install_signpost_manual_desktop: '使用瀏覽器選單將此頁面釘選或安裝為應用程式。',
    install_app_title: '一鍵直達您的網路存取',
    install_app_body:
      '將 TollGate 加入主畫面。它會直接開啟您的餘額與儲值頁面，每次連線時不必再尋找入口網站。',
    install_app_cta: '加入主畫面',
    install_app_later: '暫時不要',
    install_app_note_no_custody:
      '您的錢包保留在本裝置上。此應用程式只是通往此網路入口網站的捷徑，並非存放您資金的地方。',
    low_security_notice_title: '此連線未加密',
    low_security_notice_body: '此入口網站未透過 HTTPS 提供，請勿在此輸入助記詞或任何密碼。',
  },
};

function main() {
  const en = JSON.parse(readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
  const targetKeys = Object.keys(TRANSLATIONS.de);
  // The migration is defined against the English catalogue: a key it adds must
  // already exist in English, or the parity gate is being satisfied in the
  // wrong direction.
  for (const key of targetKeys) {
    if (!(key in en)) throw new Error(`en.json is missing ${key}; add it before running this`);
  }

  let changed = 0;
  for (const tag of Object.keys(TRANSLATIONS)) {
    const file = path.join(localesDir, `${tag}.json`);
    const catalogue = JSON.parse(readFileSync(file, 'utf8'));

    let added = 0;
    for (const key of targetKeys) {
      if (!(key in catalogue)) {
        catalogue[key] = TRANSLATIONS[tag][key];
        added += 1;
      }
    }
    if (!added) {
      console.log(`${tag}: up to date (${targetKeys.length} keys present)`);
      continue;
    }

    // Preserve the existing key order and append the new keys, matching how the
    // catalogue is already laid out (alphabetical-ish by feature, not strictly).
    writeFileSync(file, `${JSON.stringify(catalogue, null, 2)}\n`);
    console.log(`${tag}: added ${added} key(s), total ${Object.keys(catalogue).length}`);
    changed += 1;
  }
  console.log(`done: ${changed} catalogue(s) updated`);
}

main();
