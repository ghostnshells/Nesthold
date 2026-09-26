import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nesthold.game',
  appName: 'Nesthold',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#7cc576',
  },
  plugins: {
    StatusBar: { overlaysWebView: true, style: 'DARK' },
  },
};

export default config;
