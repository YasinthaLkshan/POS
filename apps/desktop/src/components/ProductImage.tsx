import { useData } from '../services/api';
import { ShoppingBasket } from 'lucide-react';
export function ProductImage({ id, available }: { id: string; available: boolean }) {
  const image = useData<{ dataUrl: string | null }>(`/products/${id}/image`, available);
  return image.data?.dataUrl ? (
    <img src={image.data.dataUrl} alt="" style={{ width: 64, height: 64, objectFit: 'contain' }} />
  ) : (
    <ShoppingBasket size={30} aria-label={image.error ? 'Image unavailable' : undefined} />
  );
}
