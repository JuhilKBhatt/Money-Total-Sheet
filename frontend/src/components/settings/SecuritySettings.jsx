// ./frontend/src/components/settings/SecuritySettings.jsx
import React, { useState, useEffect } from 'react';
import { Button, Space, Typography, Tag, Alert, Card } from 'antd';
import { LockOutlined, KeyOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text, Paragraph } = Typography;
const API_URL = import.meta.env.VITE_API_URL || '';

export default function SecuritySettings() {
  const [ledgerState, setLedgerState] = useState({
    locked: false,
    passcodeConfigured: false,
    passwordHint: '',
    hasRecoveryCodes: false,
  });

  const fetchSecurityStatus = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/ledger`);
      if (res.data) {
        const authStatus = res.data.state?.authStatus || {};
        setLedgerState({
          locked: Boolean(res.data.locked),
          passcodeConfigured: Boolean(authStatus.isConfigured),
          passwordHint: authStatus.hintQuestion || '',
          hasRecoveryCodes: Boolean(authStatus.hasRecoveryCodes),
        });
      }
    } catch (err) {
      console.error('Failed to fetch security state:', err);
    }
  };

  useEffect(() => {
    fetchSecurityStatus();
    const handler = () => fetchSecurityStatus();
    window.addEventListener('adm-auth-changed', handler);
    return () => window.removeEventListener('adm-auth-changed', handler);
  }, []);

  const handleOpenPasswordModal = () => {
    if (typeof window.openResetPasswordModal === 'function') {
      window.openResetPasswordModal();
    }
  };

  const handleLockDatabase = async () => {
    if (typeof window.lockSystem === 'function') {
      await window.lockSystem();
    } else {
      await axios.post(`${API_URL}/api/ledger`, { action: 'lock', payload: {} });
      window.dispatchEvent(new CustomEvent('adm-auth-changed', { detail: { locked: true } }));
    }
  };

  return (
    <div>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card size="small" title="Supervisor Password & Session Control">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ marginBottom: 4 }}>
                <Text strong>Status: </Text>
                {ledgerState.passcodeConfigured ? (
                  <Tag color="green">Password Configured</Tag>
                ) : (
                  <Tag color="orange">First-Time Setup Pending</Tag>
                )}
                {ledgerState.locked ? (
                  <Tag color="red">Locked</Tag>
                ) : (
                  <Tag color="blue">Unlocked (12h Session)</Tag>
                )}
                {ledgerState.hasRecoveryCodes && (
                  <Tag color="purple">4 Recovery Codes Active</Tag>
                )}
              </div>
              {ledgerState.passwordHint && (
                <div>
                  <Text type="secondary">Password Hint: {ledgerState.passwordHint}</Text>
                </div>
              )}
            </div>

            <Space wrap>
              <Button type="primary" icon={<KeyOutlined />} onClick={handleOpenPasswordModal}>
                Change / Reset Password
              </Button>
              <Button danger icon={<LockOutlined />} onClick={handleLockDatabase}>
                Lock System Now
              </Button>
            </Space>
          </div>
        </Card>
      </Space>
    </div>
  );
}
