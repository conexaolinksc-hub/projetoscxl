import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const userFirebaseConfig = {
    apiKey: "AIzaSyCIhRY45Hbdu71aS7rpBz4mqlODw2TBF28",
    authDomain: "integracaolinks.firebaseapp.com",
    projectId: "integracaolinks",
    storageBucket: "integracaolinks.firebasestorage.app",
    messagingSenderId: "560303158851",
    appId: "1:560303158851:web:0877db665ef0e3f23946f6"
};

// @ts-ignore
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : userFirebaseConfig;
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
// @ts-ignore
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'gantt-prod';
