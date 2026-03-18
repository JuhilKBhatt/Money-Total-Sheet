/* ./frontend/src/pages/Dashboard.jsx */
import React from 'react';
import { Tabs, Typography, Card, Spin } from 'antd';
import CompanyData from '../components/CompanyData';

const { Text } = Typography;

export default function Dashboard({ companies, loading }) {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: '50px' }}><Spin size="large" /></div>;
  }

  if (companies.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Text type="secondary">No companies found. Please go to Settings to add a company.</Text>
      </div>
    );
  }

  const tabItems = companies.map((company) => ({
    label: company.name,
    key: String(company.id),
    children: (
      <div style={{ padding: '10px 0' }}>
        <Card bordered={false} styles={{ body: { padding: '10px 0' } }}>
          <CompanyData companyId={company.id} companyName={company.name} />
        </Card>
      </div>
    ),
  }));

  return <Tabs type="card" items={tabItems} />;
}