// Firebase の初期化ファイル
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Firebase Console から取得したプロジェクト設定
const firebaseConfig = {
  apiKey: "AIzaSyC7LCkPsk8rHym3FuwsFY2myxvsJFdtJpc",
  authDomain: "todo-life-66.firebaseapp.com",
  projectId: "todo-life-66",
  storageBucket: "todo-life-66.firebasestorage.app",
  messagingSenderId: "780074358701",
  appId: "1:780074358701:web:d58ce90241ece58cbdb324",
  measurementId: "G-BL8KL253CS",
};

// Firebase アプリを初期化
const app = initializeApp(firebaseConfig);

// Firestore データベース
export const db = getFirestore(app);

// Firebase Authentication
export const auth = getAuth(app);

// Google ログインプロバイダー
export const googleProvider = new GoogleAuthProvider();
