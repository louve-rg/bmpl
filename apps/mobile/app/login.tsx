import { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../lib/auth-context';

export default function Login() {
  const { me, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (me) return <Redirect href="/home" />;

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/home');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: '#fff', padding: 24, justifyContent: 'center' }}
    >
      <Text style={{ fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 4 }}>
        Welcome back
      </Text>
      <Text style={{ color: '#64748b', marginBottom: 24 }}>
        Sign in to your Belize Marketplace account.
      </Text>

      {error && (
        <Text style={{ color: '#b91c1c', backgroundColor: '#fef2f2', padding: 10, borderRadius: 8, marginBottom: 12 }}>
          {error}
        </Text>
      )}

      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={inputStyle}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={inputStyle}
      />

      <Pressable
        onPress={submit}
        disabled={loading}
        style={{ backgroundColor: '#1e40af', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 }}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>Sign in</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: '#cbd5e1',
  borderRadius: 10,
  padding: 12,
  marginBottom: 12,
  fontSize: 16,
} as const;
