import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

interface LoadingSpinnerProps {
  size?: number;
  label?: string;
  fullPage?: boolean;
}

export default function LoadingSpinner({
  size = 24,
  label,
  fullPage = false,
}: LoadingSpinnerProps) {
  const spinner = (
    <div className="flex flex-col items-center justify-center gap-3">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      >
        <Loader2 size={size} className="text-primary-400" />
      </motion.div>
      {label && <p className="text-sm text-gray-400">{label}</p>}
    </div>
  );

  if (fullPage) {
    return (
      <div className="flex items-center justify-center min-h-[320px] w-full">
        {spinner}
      </div>
    );
  }

  return spinner;
}
