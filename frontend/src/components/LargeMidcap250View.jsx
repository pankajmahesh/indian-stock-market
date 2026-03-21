import IndexPredictionView from './IndexPredictionView';
import { api } from '../api';

export default function LargeMidcap250View() {
  return (
    <IndexPredictionView
      title="Nifty LargeMidcap 250"
      description="Scans all Nifty LargeMidcap 250 stocks with real-time CMP and price predictions (7/30/90 day targets)."
      apiGet={api.getLargemidcap250}
      apiScan={api.scanLargemidcap250}
      apiStatus={api.getLargemidcap250Status}
      apiLive={api.getLargemidcap250Live}
    />
  );
}
