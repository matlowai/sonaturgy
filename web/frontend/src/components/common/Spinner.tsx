export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };
  return (
    <div
      className={`${dims[size]} border-2 border-current border-t-transparent rounded-full animate-spin`}
      style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
    />
  );
}
