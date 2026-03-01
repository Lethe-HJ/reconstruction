<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { headerMenuItems, sidebarMenuItems } from './menuConfig'
import type { MenuProps } from 'ant-design-vue'

const route = useRoute()
const router = useRouter()

const selectedKey = computed(() => (route.path === '/' ? '/' : route.path))

function findSidebarParentKey (path: string): string | undefined {
  for (const item of sidebarMenuItems ?? []) {
    if (!item || typeof item === 'string') continue
    if ('children' in item && item.children) {
      const hasMatch = item.children.some(
        (child) =>
          child &&
          typeof child !== 'string' &&
          'key' in child &&
          child.key === path
      )
      if (hasMatch && typeof item.key === 'string') return item.key
    }
  }
  return undefined
}

const openKeys = ref<string[]>([])

watch(
  selectedKey,
  (path) => {
    const parentKey = findSidebarParentKey(path)
    openKeys.value = parentKey ? [parentKey] : []
  },
  { immediate: true }
)

const handleMenuNavigate: MenuProps['onClick'] = (info) => {
  if (typeof info.key === 'string' && info.key && info.key.startsWith('/')) {
    router.push(info.key)
  }
}

const handleSidebarOpenChange: MenuProps['onOpenChange'] = (keys) => {
  openKeys.value = keys as string[]
}

const headerSelectedKeys = computed(() =>
  headerMenuItems?.some(
    (item) => item && typeof item !== 'string' && item.key === selectedKey.value
  )
    ? [selectedKey.value]
    : []
)
</script>

<template>
  <a-layout style="min-height: 100%">
    <a-layout-header style="display: flex; align-items: center">
      <div class="demo-logo" />
      <a-menu
        theme="dark"
        mode="horizontal"
        :selected-keys="headerSelectedKeys"
        :items="headerMenuItems"
        style="flex: 1; min-width: 0"
        @click="handleMenuNavigate"
      />
    </a-layout-header>
    <div style="padding: 0 48px">
      <a-breadcrumb style="margin: 16px 0">
        <a-breadcrumb-item>Home</a-breadcrumb-item>
      </a-breadcrumb>
      <a-layout style="padding: 24px 0; background: #fff; border-radius: 8px">
        <a-layout-sider style="background: #fff" :width="200">
          <a-menu
            mode="inline"
            :selected-keys="[selectedKey]"
            :open-keys="openKeys"
            style="height: 100%"
            :items="sidebarMenuItems"
            @click="handleMenuNavigate"
            @update:open-keys="handleSidebarOpenChange"
          />
        </a-layout-sider>
        <a-layout-content
          style="padding: 0 24px; min-height: 280px; background: #fff; border-radius: 8px"
        >
          <router-view />
        </a-layout-content>
      </a-layout>
    </div>
  </a-layout>
</template>
