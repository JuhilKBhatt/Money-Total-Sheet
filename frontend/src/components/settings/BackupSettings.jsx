// ./frontend/src/components/settings/BackupSettings.jsx
import React from 'react';
import { Button, Space, Typography, Card, Alert } from 'antd';
import { DownloadOutlined, UploadOutlined, FileExcelOutlined, DatabaseOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export default function BackupSettings({ fetchCompanies }) {
  const handleDownloadBackup = () => {
    if (typeof window.simulateDbAction === 'function') {
      window.simulateDbAction('download-db');
    }
  };

  const handleRestoreBackup = () => {
    if (typeof window.simulateDbAction === 'function') {
      window.simulateDbAction('load-sql');
    }
  };

  const handleImportExcel = () => {
    if (typeof window.simulateDbAction === 'function') {
      window.simulateDbAction('load-xlsx');
    }
  };

  return (
    <div>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          icon={<DatabaseOutlined />}
          message="Portable Encrypted SQLite Storage"
          description="Your database lives at data/accounts_dues.sqlite with automatic WAL checkpointing on shutdown and USB removal. You can export an encrypted .bak snapshot at any time."
        />

        <Card size="small" title="Encrypted Database Backup (.bak)">
          <Paragraph type="secondary">
            Export a full encrypted snapshot (`.bak`) of all companies, pickups, metal items, deductions, settings, and customer ledgers, or restore from an existing backup file.
          </Paragraph>
          <Space wrap>
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadBackup}>
              Download Encrypted Backup (.bak)
            </Button>
            <Button icon={<UploadOutlined />} onClick={handleRestoreBackup}>
              Restore from Backup (.bak / .json)
            </Button>
            <Button icon={<FileExcelOutlined />} onClick={handleImportExcel}>
              Import Excel / CSV
            </Button>
          </Space>
        </Card>
      </Space>
    </div>
  );
}

