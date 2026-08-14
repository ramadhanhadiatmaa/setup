// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBiUsrMSgMYyYQyOBQjWNUe7tVMSjR63tM",
  authDomain: "elisabeth-antrian.firebaseapp.com",
  projectId: "elisabeth-antrian",
  storageBucket: "elisabeth-antrian.firebasestorage.app",
  messagingSenderId: "536771099273",
  appId: "1:536771099273:web:33bee53c39150727ad2458",
  measurementId: "G-9V837DQ198"
};

const COUNTER_LABEL = 'Pendaftaran';
const QUEUE_PREFIX = 'A';

function initFirebase() {
  if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error('FIREBASE_CONFIG belum diisi di public/js/config.js (copy dari Firebase Console > Project settings > Your apps)');
  }
  firebase.initializeApp(firebaseConfig);
  return {
    auth: firebase.auth(),
    db: firebase.firestore(),
  };
}
