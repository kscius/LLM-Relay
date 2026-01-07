export default function StreamingIndicator() {
  return (
    <div className="flex items-center gap-1 py-2">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-sm text-surface-400 ml-2">Thinking...</span>
    </div>
  );
}

