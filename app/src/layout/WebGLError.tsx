import { Activity, RefreshCw } from "lucide-react";
import type React from "react";

const WebGlError: React.FC = () => {
  return (
    <div className="flex min-h-96 w-full flex-col items-center justify-center">
      <Activity className="m-3 h-40 w-40 animate-pulse rounded-full bg-popover p-3" />
      <p>Error loading the game renderer.</p>
      <p className="font-bold text-red-500">
        Refresh to reload the graphics and try again.
      </p>
      <button
        type="button"
        className="animate-pulse hover:cursor-pointer hover:text-orange-500"
        onClick={() => location.reload()}
      >
        Refresh <RefreshCw className="inline h-5 w-5" />
      </button>
    </div>
  );
};

export default WebGlError;
