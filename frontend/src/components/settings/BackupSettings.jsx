// ./frontend/src/components/settings/BackupSettings.jsx
import React, { useRef, useState } from 'react';
import { Button, Space, Typography, Card, Alert, Modal, Input, message } from 'antd';
import {
  DownloadOutlined,
  UploadOutlined,
  FileExcelOutlined,
  DatabaseOutlined,
  ConsoleSqlOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export default function BackupSettings({ fetchCompanies }) {
  const sqlInputRef = useRef(null);
  const [restoringSql, setRestoringSql] = useState(false);
  const [lastRestoreResult, setLastRestoreResult] = useState(null);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmationText, setResetConfirmationText] = useState('');
  const [resettingDb, setResettingDb] = useState(false);

  const [downloadingSql, setDownloadingSql] = useState(false);

  const handleDownloadBackup = async () => {
    setDownloadingSql(true);
    try {
      const response = await fetch('/database/export-sql');
      const data = await response.json();
      if (!response.ok || !data.ok || typeof data.sql !== 'string') {
        throw new Error(data.detail || data.error || 'Failed to export SQL backup.');
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      const blob = new Blob([data.sql], { type: 'application/sql;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `money_total_sheet_backup_${dateStr}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success('Database backup (.sql) downloaded successfully.');
    } catch (err) {
      message.error(err.message || 'Failed to download .sql backup.');
    } finally {
      setDownloadingSql(false);
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

  const handleTriggerSqlFileSelect = () => {
    if (sqlInputRef.current) {
      sqlInputRef.current.value = '';
      sqlInputRef.current.click();
    }
  };

  const handleSqlFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoringSql(true);
    setLastRestoreResult(null);
    try {
      const sqlContent = await file.text();
      const response = await fetch('/database/restore-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlContent, fileName: file.name }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.detail || data.error || 'Failed to restore SQL file.');
      }

      const stats = data.stats || {};
      setLastRestoreResult({
        fileName: file.name,
        stats,
      });

      message.success(
        `Migrated ${stats.companies || 0} companies, ${stats.pickups || 0} pickups (${stats.metals || 0} metal items), and ${stats.deductions || 0} deductions into the encrypted database!`
      );

      if (typeof fetchCompanies === 'function') {
        await fetchCompanies();
      }
      window.dispatchEvent(new CustomEvent('adm-auth-changed', { detail: { locked: false } }));
    } catch (err) {
      message.error(err.message || 'Failed to restore from .sql file.');
    } finally {
      setRestoringSql(false);
    }
  };

  const handleOpenResetModal = () => {
    setResetConfirmationText('');
    setResetModalOpen(true);
  };

  const handleConfirmResetDatabase = async () => {
    const cleaned = resetConfirmationText.trim().toLowerCase();
    if (cleaned !== 'delete') {
      message.warning('Please type "delete" to confirm resetting the database.');
      return;
    }

    setResettingDb(true);
    try {
      const response = await fetch('/database/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'delete' }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.detail || data.error || 'Failed to reset database.');
      }

      setResetModalOpen(false);
      setResetConfirmationText('');
      setLastRestoreResult(null);
      message.success('Encrypted database has been reset to an empty state.');

      if (typeof fetchCompanies === 'function') {
        await fetchCompanies();
      }
      window.dispatchEvent(new CustomEvent('adm-auth-changed', { detail: { locked: false } }));
    } catch (err) {
      message.error(err.message || 'Failed to reset database.');
    } finally {
      setResettingDb(false);
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
          description="Your database lives at data/accounts_dues.sqlite with automatic WAL checkpointing on shutdown and USB removal. You can export or restore a .sql database backup at any time."
        />

        <Card size="small" title="Database Backup & Restore (.sql)">
          <Paragraph type="secondary">
            Download a full SQL backup (<Text code>.sql</Text>) of all companies, pickups, metal weight/price items, deductions, yards, currencies, and weight units, or restore from an existing <Text code>.sql</Text> file into this encrypted database.
          </Paragraph>
          <input
            ref={sqlInputRef}
            type="file"
            accept=".sql"
            style={{ display: 'none' }}
            onChange={handleSqlFileChange}
          />
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloadingSql}
                onClick={handleDownloadBackup}
              >
                Download Database Backup (.sql)
              </Button>
              <Button
                icon={<ConsoleSqlOutlined />}
                loading={restoringSql}
                onClick={handleTriggerSqlFileSelect}
              >
                Restore from SQL File (.sql)
              </Button>
              <Button icon={<FileExcelOutlined />} onClick={handleImportExcel}>
                Import Excel / CSV
              </Button>
            </Space>
            {lastRestoreResult && (
              <Alert
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                message={`Successfully restored "${lastRestoreResult.fileName}"`}
                description={`Encrypted & imported ${lastRestoreResult.stats.companies || 0} companies, ${lastRestoreResult.stats.pickups || 0} pickups, ${lastRestoreResult.stats.metals || 0} metal items, ${lastRestoreResult.stats.deductions || 0} deductions, ${lastRestoreResult.stats.yards || 0} yards, ${lastRestoreResult.stats.currencies || 0} currencies, and ${lastRestoreResult.stats.units || 0} weight units.`}
              />
            )}
          </Space>
        </Card>

        <Card
          size="small"
          title={<Text type="danger">Danger Zone — Reset Database</Text>}
          style={{ borderColor: '#ffa39e' }}
        >
          <Paragraph type="secondary">
            Permanently wipe all companies, pickups, metal items, deductions, yards, currencies, weight units, and ledger records, returning the database to a clean empty state. Your supervisor password and encryption key will remain intact.
          </Paragraph>
          <Button
            danger
            type="primary"
            icon={<DeleteOutlined />}
            onClick={handleOpenResetModal}
          >
            Reset Database
          </Button>
        </Card>
      </Space>

      <Modal
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
            <span>Reset Encrypted Database</span>
          </Space>
        }
        open={resetModalOpen}
        onCancel={() => setResetModalOpen(false)}
        onOk={handleConfirmResetDatabase}
        okText="Confirm Reset Database"
        okButtonProps={{
          danger: true,
          loading: resettingDb,
          disabled: resetConfirmationText.trim().toLowerCase() !== 'delete',
        }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="This action cannot be undone"
            description="All companies, pickups, metal items, deductions, yards, currencies, weight units, and customer balances will be permanently deleted from data/accounts_dues.sqlite."
          />
          <div>
            <Text strong>
              Type <Text code>delete</Text> below to confirm resetting the database:
            </Text>
            <Input
              style={{ marginTop: 8 }}
              placeholder="delete"
              value={resetConfirmationText}
              onChange={(e) => setResetConfirmationText(e.target.value)}
              onPressEnter={handleConfirmResetDatabase}
              autoFocus
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}


