import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../lib/auth-context';

export default function Index() {
  const { loading, me } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e40af' }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }
  return <Redirect href={me ? '/home' : '/login'} />;
}
