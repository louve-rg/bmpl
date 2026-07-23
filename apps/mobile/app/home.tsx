import { useState } from 'react';
import { Redirect } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { RoleCode } from '@bmpl/shared';
import { useAuth } from '../lib/auth-context';
import { mobileApi } from '../lib/api';

/** Foundation home: shows the account, an approved-role switcher, and roles. */
export default function Home() {
  const { me, signOut, refreshMe } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!me) return <Redirect href="/login" />;

  const selectable = me.roles.filter((r) => r.isSelectable);

  async function switchRole(roleCode: RoleCode) {
    if (busy || roleCode === me!.activeRole) return;
    setBusy(true);
    try {
      await mobileApi.post('/roles/switch', { roleCode });
      await refreshMe();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f1f5f9' }} contentContainerStyle={{ padding: 20 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a' }}>Hi, {me.firstName} 👋</Text>
      <Text style={{ color: '#64748b', marginBottom: 20 }}>{me.email}</Text>

      <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>
        Active role
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {selectable.map((r) => {
          const active = r.roleCode === me.activeRole;
          return (
            <Pressable
              key={r.roleCode}
              onPress={() => switchRole(r.roleCode)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                backgroundColor: active ? '#1e40af' : '#fff',
                borderWidth: 1,
                borderColor: active ? '#1e40af' : '#cbd5e1',
              }}
            >
              <Text style={{ color: active ? '#fff' : '#334155', fontWeight: '600' }}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>
        Your roles
      </Text>
      <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 4, marginBottom: 24 }}>
        {me.roles.map((r) => (
          <View
            key={r.roleCode}
            style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 12 }}
          >
            <Text style={{ color: '#0f172a', fontWeight: '500' }}>{r.label}</Text>
            <Text style={{ color: r.status === 'APPROVED' ? '#15803d' : '#b45309', fontSize: 13 }}>
              {r.status.replace(/_/g, ' ')}
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={signOut}
        style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, alignItems: 'center' }}
      >
        <Text style={{ color: '#334155', fontWeight: '600' }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
