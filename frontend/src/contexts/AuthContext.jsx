// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Check for saved session
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error('Failed to parse user data', e);
      }
    }
    setLoading(false);
  }, []);

  const login = async (credentials) => {
    try {
      // TODO: Replace with actual authentication
      const mockUser = { 
        id: '123', 
        email: credentials.email,
        name: credentials.email.split('@')[0] 
      };
      
      setUser(mockUser);
      if (credentials.rememberMe) {
        localStorage.setItem('user', JSON.stringify(mockUser));
      }
      
      // Redirect to the Join page after successful login
      navigate('/join');
      return mockUser;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const signup = async (userData) => {
    try {
      // TODO: Replace with actual signup API call
      console.log('Signup data:', userData);
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const newUser = {
        id: 'new-user-' + Date.now(),
        email: userData.email,
        name: userData.name
      };
      
      setUser(newUser);
      localStorage.setItem('user', JSON.stringify(newUser));
      
      // Redirect to the Join page after successful signup
      navigate('/join');
      return newUser;
    } catch (error) {
      console.error('Signup failed:', error);
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      login, 
      logout, 
      signup,
      loading,
      isAuthenticated: !!user
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  return useContext(AuthContext);
};