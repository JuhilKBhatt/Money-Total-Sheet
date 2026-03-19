/* ./frontend/src/components/CompanyData.jsx */
import React, { useState, useEffect } from 'react';
import { Button, message, Spin, Form, Space, DatePicker, Typography } from 'antd';
import { PlusOutlined, DollarOutlined, ArrowUpOutlined, ArrowDownOutlined, ReloadOutlined, FilterOutlined, CloseOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

import LedgerTable from './LedgerTable';
import PickupModal from './PickupModal';
import DeductionModal from './DeductionModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function CompanyData({ companyId, companyName }) {
  const [pickups, setPickups] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [yards, setYards] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isPickupModalVisible, setIsPickupModalVisible] = useState(false);
  const [isDeductionModalVisible, setIsDeductionModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  
  const [dateRange, setDateRange] = useState(null);
  
  // New state for click-toggle
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);

  const [pickupForm] = Form.useForm();
  const [deductionForm] = Form.useForm();

  useEffect(() => {
    fetchCompanyData();
    fetchOptions();
  }, [companyId]);

  const fetchOptions = async () => {
    try {
      const [yardsRes, currRes, unitsRes] = await Promise.all([
        axios.get(`${API_URL}/yards/`),
        axios.get(`${API_URL}/currencies/`),
        axios.get(`${API_URL}/units/`)
      ]);
      setYards(yardsRes.data);
      setCurrencies(currRes.data);
      setUnits(unitsRes.data);
    } catch (error) {
      console.error("Failed to load options");
    }
  };

  const fetchCompanyData = async () => {
    try {
      setLoading(true);
      const [pickupsRes, deductionsRes] = await Promise.all([
        axios.get(`${API_URL}/companies/${companyId}/pickups/`),
        axios.get(`${API_URL}/companies/${companyId}/deductions/`)
      ]);
      setPickups(pickupsRes.data);
      setDeductions(deductionsRes.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const defaultCurrency = currencies.length > 0 ? currencies[0].label : '$';
  const defaultUnit = units.length > 0 ? units[0].value : 'kg';

  // --- Modals ---
  const openAddPickup = () => {
    setEditingId(null);
    pickupForm.resetFields();
    pickupForm.setFieldsValue({ currency: defaultCurrency });
    setIsPickupModalVisible(true);
  };

  const openEditPickup = (pickup) => {
    setEditingId(pickup.id);
    pickupForm.setFieldsValue({
      date: dayjs(pickup.date),
      yard: pickup.yard,
      notes: pickup.notes,
      currency: pickup.currency || defaultCurrency,
      metals: pickup.metals
    });
    setIsPickupModalVisible(true);
  };

  const openAddDeduction = () => {
    setEditingId(null);
    deductionForm.resetFields();
    deductionForm.setFieldsValue({ currency: defaultCurrency });
    setIsDeductionModalVisible(true);
  };

  const openEditDeduction = (deduction) => {
    setEditingId(deduction.id);
    deductionForm.setFieldsValue({
      date: dayjs(deduction.date),
      amount: deduction.amount,
      notes: deduction.notes,
      currency: deduction.currency || defaultCurrency
    });
    setIsDeductionModalVisible(true);
  };

  // --- Handlers ---
  const handlePickupSubmit = async (values) => {
    try {
      const cleanMetals = (values.metals || [])
        .filter(metal => metal && metal.metal_name)
        .map(metal => {
          let nw = parseFloat(metal.net_weight);
          if (isNaN(nw)) nw = 0.0;
          
          let ppu = parseFloat(metal.price_per_unit);
          if (isNaN(ppu)) ppu = 0.0;

          return {
            metal_name: String(metal.metal_name),
            net_weight: nw,
            weight_unit: String(metal.weight_unit || defaultUnit),
            price_per_unit: ppu
          };
        });

      const payload = {
        date: values.date ? values.date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        yard: String(values.yard || ""),
        currency: String(values.currency || "$"),
        notes: String(values.notes || ""),
        deduction: 0.0,
        metals: cleanMetals
      };

      if (editingId) {
        await axios.put(`${API_URL}/pickups/${editingId}`, payload);
        message.success("Trip updated successfully.");
      } else {
        await axios.post(`${API_URL}/pickups/`, { ...payload, company_id: companyId });
        message.success("New trip added successfully.");
      }

      setIsPickupModalVisible(false);
      setEditingId(null);
      fetchCompanyData();
    } catch (error) {
      console.error("Error saving pickup:", error);
      if (error.response && error.response.status === 422) {
        const details = error.response.data.detail;
        message.error(`Validation Error: ${JSON.stringify(details)}`, 5);
      } else {
        message.error("Failed to save trip. Please check your data.");
      }
    }
  };

  const handleDeductionSubmit = async (values) => {
    try {
      let amount = parseFloat(values.amount);
      if (isNaN(amount)) amount = 0.0;

      const payload = {
        date: values.date ? values.date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        amount: amount,
        currency: String(values.currency || "$"),
        notes: String(values.notes || "")
      };

      if (editingId) {
        await axios.put(`${API_URL}/deductions/${editingId}`, payload);
        message.success("Deduction updated.");
      } else {
        await axios.post(`${API_URL}/deductions/`, { ...payload, company_id: companyId });
        message.success("Deduction added.");
      }

      setIsDeductionModalVisible(false);
      setEditingId(null);
      fetchCompanyData();
    } catch (error) {
      console.error("Error saving deduction:", error);
      if (error.response && error.response.status === 422) {
        message.error(`Validation Error: ${JSON.stringify(error.response.data.detail)}`, 5);
      } else {
        message.error("Failed to save deduction.");
      }
    }
  };

  const handleDeletePickup = async (id) => { 
    try {
      await axios.delete(`${API_URL}/pickups/${id}`); 
      message.success("Trip deleted.");
      fetchCompanyData(); 
    } catch (error) {
      console.error("Error deleting pickup:", error);
      message.error("Failed to delete trip.");
    }
  };

  const handleDeleteDeduction = async (id) => { 
    try {
      await axios.delete(`${API_URL}/deductions/${id}`); 
      message.success("Deduction deleted.");
      fetchCompanyData(); 
    } catch (error) {
      console.error("Error deleting deduction:", error);
      message.error("Failed to delete deduction.");
    }
  };

  // --- Logic ---
  const buildLedgerData = () => {
    let events = [];
    pickups.forEach(p => events.push({ ...p, eventType: 'pickup' }));
    deductions.forEach(d => events.push({ ...d, eventType: 'deduction' }));

    events.sort((a, b) => {
      const dateA = new Date(a.date), dateB = new Date(b.date);
      if (dateA < dateB) return -1;
      if (dateA > dateB) return 1;
      if (a.eventType === 'pickup' && b.eventType === 'deduction') return -1;
      if (a.eventType === 'deduction' && b.eventType === 'pickup') return 1;
      return 0;
    });

    const data = [];
    let runningBalances = {};

    events.forEach((event, index) => {
      const nextEvent = events[index + 1];
      const eventCurr = event.currency || defaultCurrency;

      if (runningBalances[eventCurr] === undefined) {
        runningBalances[eventCurr] = 0;
      }

      if (event.eventType === 'pickup') {
        const metalCount = event.metals && event.metals.length > 0 ? event.metals.length : 1;

        if (event.metals && event.metals.length > 0) {
          event.metals.forEach((metal, mIndex) => {
            const metalTotal = metal.net_weight * metal.price_per_unit;
            runningBalances[eventCurr] += metalTotal;
            data.push({
              key: `metal-${metal.id}`,
              type: 'metal',
              rawPickup: event,
              isoDate: event.date,
              date: dayjs(event.date).format('DD/MM/YYYY'),
              yardNotes: [event.yard, event.notes].filter(Boolean).join(' - '),
              metal: metal.metal_name,
              kg: metal.net_weight,
              weight_unit: metal.weight_unit || defaultUnit,
              price: metal.price_per_unit,
              total: metalTotal,
              currency: eventCurr,
              rowSpan: mIndex === 0 ? metalCount : 0
            });
          });
        }
        
        if (!nextEvent || nextEvent.eventType === 'deduction' || (nextEvent.eventType === 'pickup' && nextEvent.date !== event.date)) {
          Object.keys(runningBalances).sort().forEach(curr => {
            data.push({ 
              key: `bal-p-${event.id}-${curr}`, 
              type: 'balance', 
              isoDate: event.date,
              priceLabel: `BAL (${curr}) till date >`, 
              total: runningBalances[curr], 
              currency: curr 
            });
          });
        }
      } else if (event.eventType === 'deduction') {
        runningBalances[eventCurr] -= event.amount;
        data.push({
          key: `deduction-${event.id}`,
          type: 'deduction',
          rawDeduction: event,
          isoDate: event.date,
          date: dayjs(event.date).format('DD/MM/YYYY'), 
          yardNotes: event.notes || 'Deduction', 
          metal: '', kg: '', price: '',
          total: event.amount,
          currency: eventCurr,
          rowSpan: 1
        });
        
        if (!nextEvent || nextEvent.eventType === 'pickup') {
          Object.keys(runningBalances).sort().forEach(curr => {
            data.push({ 
              key: `bal-d-${event.id}-${curr}`, 
              type: 'balance', 
              isoDate: event.date,
              priceLabel: `BAL (${curr}) till date >`, 
              total: runningBalances[curr], 
              currency: curr 
            });
          });
        }
      }
    });

    return data;
  };

  const rawTableData = buildLedgerData();
  
  let tableData = rawTableData;
  if (dateRange && dateRange[0] && dateRange[1]) {
    const startDate = dateRange[0].startOf('day');
    const endDate = dateRange[1].endOf('day');
    tableData = rawTableData.filter(row => {
      if (!row.isoDate) return true;
      const rowDate = dayjs(row.isoDate);
      return (rowDate.isSame(startDate, 'day') || rowDate.isAfter(startDate, 'day')) && 
             (rowDate.isSame(endDate, 'day') || rowDate.isBefore(endDate, 'day'));
    });
  }
  
  const grandTotals = {};
  pickups.forEach(pickup => {
    const c = pickup.currency || defaultCurrency;
    if (!grandTotals[c]) grandTotals[c] = 0;
    grandTotals[c] += (pickup.metals || []).reduce((mSum, metal) => mSum + (metal.total || 0), 0);
  });
  deductions.forEach(deduction => {
    const c = deduction.currency || defaultCurrency;
    if (!grandTotals[c]) grandTotals[c] = 0;
    grandTotals[c] -= (deduction.amount || 0);
  });

  // Extract unique metal names for the autocomplete feature
  const metalOptions = Array.from(
    new Set(pickups.flatMap(p => (p.metals || []).map(m => m.metal_name)))
  ).filter(Boolean).sort().map(name => ({ value: name }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
      
      {/* Click-Toggle Collapsible Floating Panel */}
      <div 
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '24px',
          zIndex: 999,
          background: 'rgba(255, 255, 255, 0.98)',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          border: '1px solid #f0f0f0',
          overflow: 'hidden',
          transition: 'all 0.3s ease',
        }}
      >
        {!isPanelExpanded ? (
          <div 
            onClick={() => setIsPanelExpanded(true)}
            style={{ width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            title="Open Control Panel"
          >
            <FilterOutlined style={{ fontSize: '20px', color: '#595959' }} />
          </div>
        ) : (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text strong style={{ fontSize: '13px' }}>
                Filter by Date
              </Typography.Text>
              <Button 
                type="text" 
                icon={<CloseOutlined />} 
                size="small" 
                onClick={() => setIsPanelExpanded(false)} 
                style={{ color: '#999' }}
                title="Close Control Panel"
              />
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
              <DatePicker.RangePicker 
                value={dateRange}
                format="DD/MM/YYYY" 
                onChange={(dates) => setDateRange(dates)} 
                style={{ width: '250px' }}
                allowClear
              />
              <Button 
                icon={<ReloadOutlined />} 
                onClick={() => setDateRange(null)}
                title="Reset Date Filter"
              >
                Reset
              </Button>
            </div>
            <Space style={{ display: 'flex' }}>
              <Button 
                icon={<ArrowUpOutlined />} 
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                style={{ flex: 1 }}
              >
                Top
              </Button>
              <Button 
                icon={<ArrowDownOutlined />} 
                onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
                style={{ flex: 1 }}
              >
                Bottom
              </Button>
            </Space>
          </div>
        )}
      </div>

      {loading ? <Spin style={{ display: 'block', margin: '40px auto' }} /> : (
        <LedgerTable 
          tableData={tableData} loading={loading} grandTotals={grandTotals} defaultCurrency={defaultCurrency}
          openEditDeduction={openEditDeduction} handleDeleteDeduction={handleDeleteDeduction}
          openEditPickup={openEditPickup} handleDeletePickup={handleDeletePickup}
          companyName={companyName} 
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Space>
          <Button 
            type="primary" 
            size="large" 
            style={{ fontSize: '16px', fontWeight: '600', padding: '0 24px', height: '40px' }} 
            icon={<PlusOutlined />} 
            onClick={openAddPickup}
          >
            Add Pickup / Drop Off
          </Button>
          <Button 
            danger 
            type="primary"
            size="large" 
            style={{ fontSize: '16px', fontWeight: '600', padding: '0 24px', height: '40px' }} 
            icon={<DollarOutlined />} 
            onClick={openAddDeduction}
          >
            Minus Deductions
          </Button>
        </Space>
      </div>

      <PickupModal 
        visible={isPickupModalVisible} 
        onCancel={() => { setIsPickupModalVisible(false); setEditingId(null); }}
        onSubmit={handlePickupSubmit} 
        form={pickupForm} 
        yards={yards} 
        currencies={currencies} 
        units={units} 
        editingId={editingId} 
        defaultUnit={defaultUnit} 
        metalOptions={metalOptions} 
      />
      
      <DeductionModal 
        visible={isDeductionModalVisible} 
        onCancel={() => { setIsDeductionModalVisible(false); setEditingId(null); }}
        onSubmit={handleDeductionSubmit} 
        form={deductionForm} 
        currencies={currencies} 
        editingId={editingId} 
      />
    </div>
  );
}