import IndexPredictionView from './IndexPredictionView';
import { api } from '../api';

export default function Midcap150View() {
  return (
    <IndexPredictionView
      title="Nifty Midcap 150"
      description="Scans all Nifty Midcap 150 stocks with real-time CMP and price predictions (7/30/90 day targets)."
      apiGet={api.getMidcap150}
      apiScan={api.scanMidcap150}
      apiStatus={api.getMidcap150Status}
      apiLive={api.getMidcap150Live}
    />
  );
}
