import Image from 'next/image';
import { cn } from '@/lib/ui';

const DIMS = {
  sm: { outer: 'w-6 h-6', wh: 22 },
  md: { outer: 'w-10 h-10', wh: 40 },
  lg: { outer: 'w-16 h-16', wh: 60 },
  xl: { outer: 'w-28 h-28', wh: 104 },
} as const;

export type BrandLogoSize = keyof typeof DIMS;

type BrandLogoProps = {
  size?: BrandLogoSize;
  /** Login card: larger ring around the mark */
  padded?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export function BrandLogo({ size = 'md', padded, className, children }: BrandLogoProps) {
  const { outer, wh } = DIMS[size];
  const ring = padded
    ? 'w-20 h-20 border-slate-200 bg-white shadow-md shadow-slate-200/50'
    : cn('border-slate-200 bg-white shadow-sm', outer);
  const imgSize = padded ? 56 : wh;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'rounded-full border flex items-center justify-center overflow-hidden shrink-0',
          children ? 'mr-2' : '',
          ring,
        )}
      >
        <Image
          src="/logo.png"
          alt="Tehsil T Procurement Logo"
          width={imgSize}
          height={imgSize}
          className="h-full w-full object-contain p-0.5"
          priority={size !== 'sm'}
        />
      </div>
      {children}
    </div>
  );
}
