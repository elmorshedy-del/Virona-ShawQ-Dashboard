export default function CurrencyToggle({ value, onChange, store }) {
  // Only show for Shawq
  if (store !== 'shawq') return null;

  return (
    <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
      <button
        onClick={() => onChange('USD')}
        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          value === 'USD'
            ? 'bg-white shadow text-gray-900'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        USD $
      </button>
      <button
        onClick={() => onChange('TRY')}
        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          value === 'TRY'
            ? 'bg-white shadow text-gray-900'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        TRY ₺
      </button>
    </div>
  );
}
