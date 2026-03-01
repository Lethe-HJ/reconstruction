import type { MenuProps } from 'ant-design-vue'

export const headerMenuItems: MenuProps['items'] = [
  { key: '/', label: '首页' },
  { key: '/surface-nets', label: 'Surface Nets' }
]

export const sidebarMenuItems: MenuProps['items'] = [
  {
    key: 'overview',
    label: '概览',
    children: [{ key: '/', label: '项目概览' }]
  },
  {
    key: 'surface-nets',
    label: 'Surface Nets',
    children: [{ key: '/surface-nets', label: '案例一' }]
  },
  {
    key: 'notifications',
    label: '消息中心',
    children: [{ key: 'todo', label: '待办提醒' }]
  }
]
