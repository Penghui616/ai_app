import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfigProvider locale={zhCN} button={{autoInsertSpace:false}} theme={{token:{colorPrimary:'#2563eb',borderRadius:8,fontFamily:'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',fontSize:14,colorText:'#23324a',controlHeight:38}}}><AntApp><App/></AntApp></ConfigProvider></React.StrictMode>);
