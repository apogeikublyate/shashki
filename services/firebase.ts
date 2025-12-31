import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCEvN1NTncNhRxERbFMKrNGg6h5pUxoW5U",
  authDomain: "shashki-a6b99.firebaseapp.com",
  projectId: "shashki-a6b99",
  storageBucket: "shashki-a6b99.firebasestorage.app",
  messagingSenderId: "160125139960",
  appId: "1:160125139960:web:e1973baf30fe245ad6f40d",
};

export const isConfigured = true;

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const db = firebase.firestore();
