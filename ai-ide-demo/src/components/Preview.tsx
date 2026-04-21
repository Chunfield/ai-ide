import { useState } from 'react';

interface PreviewProps {
  code: string;
}

type Viewport = 'desktop' | 'tablet' | 'mobile';

export function Preview({ code }: PreviewProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');

  const getViewportWidth = () => {
    switch (viewport) {
      case 'mobile':
        return '375px';
      case 'tablet':
        return '768px';
      case 'desktop':
      default:
        return '100%';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#3c3c3c]">
        <span className="text-sm text-gray-400">预览</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewport('desktop')}
            className={`p-1.5 rounded text-xs ${
              viewport === 'desktop'
                ? 'bg-[#007acc] text-white'
                : 'text-gray-400 hover:bg-[#3c3c3c]'
            }`}
            title="桌面视图"
          >
            🖥️
          </button>
          <button
            onClick={() => setViewport('tablet')}
            className={`p-1.5 rounded text-xs ${
              viewport === 'tablet'
                ? 'bg-[#007acc] text-white'
                : 'text-gray-400 hover:bg-[#3c3c3c]'
            }`}
            title="平板视图"
          >
            📱
          </button>
          <button
            onClick={() => setViewport('mobile')}
            className={`p-1.5 rounded text-xs ${
              viewport === 'mobile'
                ? 'bg-[#007acc] text-white'
                : 'text-gray-400 hover:bg-[#3c3c3c]'
            }`}
            title="手机视图"
          >
            📱
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-white p-4 flex justify-center">
        <div
          className="bg-white transition-all duration-300 ease-in-out overflow-auto"
          style={{
            width: getViewportWidth(),
            maxWidth: '100%',
            height: '100%',
          }}
        >
          <iframe
            srcDoc={code}
            sandbox="allow-scripts allow-same-origin"
            title="preview"
            className="w-full h-full border-0"
          />
        </div>
      </div>
    </div>
  );
}
