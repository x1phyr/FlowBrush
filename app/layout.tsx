import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'FlowBrush · 2D FlowMap 编辑器',
  description: '绘制流向，预览水流，导出可直接用于 Shader 的 FlowMap。',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="dark">
      <body>{children}</body>
    </html>
  );
}
