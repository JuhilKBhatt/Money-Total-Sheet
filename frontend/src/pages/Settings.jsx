/* ./frontend/src/pages/Settings.jsx */
import React from 'react';
import { Collapse, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';

// Import our new sub-components
import CompanySettings from '../components/settings/CompanySettings';
import YardSettings from '../components/settings/YardSettings';
import CurrencySettings from '../components/settings/CurrencySettings';
import UnitSettings from '../components/settings/UnitSettings';

const { Panel } = Collapse;
const { Text } = Typography;

export default function Settings({ companies, fetchCompanies }) {
  const headerText = (title) => <Text strong style={{ fontSize: '18px' }}>{title}</Text>;

  return (
    <div style={{ maxWidth: 800, margin: '24px auto' }}>
      <h2 style={{ marginBottom: 24 }}><SettingOutlined /> System Settings</h2>
      
      <Collapse defaultActiveKey={['1']} accordion>
        <Panel header={headerText("Companies")} key="1">
          <CompanySettings companies={companies} fetchCompanies={fetchCompanies} />
        </Panel>

        <Panel header={headerText("Yards")} key="2">
          <YardSettings />
        </Panel>

        <Panel header={headerText("Currencies")} key="3">
          <CurrencySettings />
        </Panel>

        <Panel header={headerText("Weight Units")} key="4">
          <UnitSettings />
        </Panel>
      </Collapse>
    </div>
  );
}