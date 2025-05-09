import { createContext, useContext, useState, useEffect } from 'react';
import { auth, database, ref, set, get } from '../config/firebase';
import { User, Role } from '../data/users';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile as updateFirebaseProfile,
  User as FirebaseUser
} from 'firebase/auth';

// Define the AuthContextProps interface
interface AuthContextProps {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string, name: string, role: Role) => Promise<boolean>;
  logout: () => Promise<void>;
  updateUser: (userData: Partial<User>) => Promise<void>;
}

const AuthContext = createContext<AuthContextProps>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => false,
  signup: async () => false,
  logout: async () => {},
  updateUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for authenticated user on startup and listen for auth state changes
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      try {
        if (firebaseUser) {
          // User is signed in
          const userRef = ref(database, `users/${firebaseUser.uid}`);
          const snapshot = await get(userRef);
          let userData: User | null = null;

          if (snapshot.exists()) {
            userData = snapshot.val();
          } else {
            // Create basic user object if not in database yet
            userData = {
              id: firebaseUser.uid,
              email: firebaseUser.email || '',
              password: '', // We don't store passwords
              name: firebaseUser.displayName || '',
              role: 'student', // Default role
              avatar: null,
              bio: '',
              enrolledCourses: [],
              lastLogin: new Date(),
            };
            // Save the new user data to Firebase
            await set(userRef, userData);
          }

          // Also store in AsyncStorage for offline access
          await AsyncStorage.setItem(`user_${firebaseUser.uid}`, JSON.stringify(userData));
          setUser(userData);
        } else {
          // User is signed out
          setUser(null);
        }
      } catch (error) {
        console.error('Error retrieving user data:', error);
      } finally {
        setIsLoading(false);
      }
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;

      // Update last login time
      const userRef = ref(database, `users/${firebaseUser.uid}`);
      const snapshot = await get(userRef);
      if (snapshot.exists()) {
        const userData = snapshot.val();
        userData.lastLogin = new Date();
        await set(userRef, userData);
        // Also update AsyncStorage
        await AsyncStorage.setItem(`user_${firebaseUser.uid}`, JSON.stringify(userData));
      }

      return true;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const signup = async (email: string, password: string, name: string, role: Role): Promise<boolean> => {
    try {
      // Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;

      // Update profile with display name
      await updateFirebaseProfile(firebaseUser, { displayName: name });

      // Create user data object
      const userData: User = {
        id: firebaseUser.uid,
        email: email,
        password: '', // We don't store passwords
        name: name,
        role: role,
        avatar: null,
        bio: '',
        enrolledCourses: [],
        lastLogin: new Date(),
      };

      // If user is instructor, add empty createdCourses array
      if (role === 'instructor') {
        userData.createdCourses = [];
      }

      // Store user data in Firebase
      const userRef = ref(database, `users/${firebaseUser.uid}`);
      await set(userRef, userData);

      // Also store in AsyncStorage for offline access
      await AsyncStorage.setItem(`user_${firebaseUser.uid}`, JSON.stringify(userData));

      return true;
    } catch (error) {
      console.error('Signup error:', error);
      return false;
    }
  };

  const logout = async () => {
    try {
      await auth.signOut();
      setUser(null);
      router.replace('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const updateUser = async (userData: Partial<User>) => {
    if (user) {
      try {
        const updatedUser = { ...user, ...userData };
        setUser(updatedUser);

        // Update display name in Firebase if it changed
        if (userData.name && auth.currentUser) {
          await updateFirebaseProfile(auth.currentUser, { displayName: userData.name });
        }

        // Store updated user data in Firebase
        const userRef = ref(database, `users/${user.id}`);
        await set(userRef, updatedUser);

        // Also update AsyncStorage for offline access
        await AsyncStorage.setItem(`user_${user.id}`, JSON.stringify(updatedUser));
      } catch (error) {
        console.error('Update user error:', error);
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        signup,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};