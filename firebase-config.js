/* =========================================================
   Firebase 설정 파일 (샘플)

   1) https://console.firebase.google.com 에서 새 프로젝트 생성 (무료)
   2) 프로젝트 설정 > 일반 > "내 앱" 에서 웹 앱 추가 (</> 아이콘)
   3) 아래에 나오는 firebaseConfig 값을 복사해서 이 파일의 값들을 교체
   4) 이 파일 이름을 firebase-config.js 로 바꾸기
      (firebase-config.js 는 .gitignore 에 넣지 않아도 됩니다 -
       이 값들은 비밀키가 아니라 공개되어도 되는 값입니다.
       실제 보안은 Firestore 규칙(firestore.rules)이 담당합니다.)
   ========================================================= */

const firebaseConfig = {
apiKey: "AIzaSyC2oQ69p2Mi8QVUASarpSNpsumvpbaUHFs",
  authDomain: "sign-language-99ec5.firebaseapp.com",
  projectId: "sign-language-99ec5",
  storageBucket: "sign-language-99ec5.firebasestorage.app",
  messagingSenderId: "658891995044",
  appId: "1:658891995044:web:65194d3834fe0b6bc07331",
  measurementId: "G-JZN26F6E05"
};

firebase.initializeApp(firebaseConfig);
