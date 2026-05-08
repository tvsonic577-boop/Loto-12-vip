import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { 
  getFirestore, doc, getDocFromServer, onSnapshot, collection, query, 
  where, addDoc, updateDoc, serverTimestamp, setDoc, getDoc,
  writeBatch, deleteDoc, getDocs, increment
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
console.log("DEBUG: Database ID from config:", firebaseConfig.firestoreDatabaseId);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

// Test connection as required by integration guidelines
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

testConnection();

export { 
  onSnapshot, 
  collection, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  writeBatch,
  deleteDoc,
  getDocs,
  increment
};
