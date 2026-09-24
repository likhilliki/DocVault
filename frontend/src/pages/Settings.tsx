import { useAuthenticator } from "@aws-amplify/ui-react";
import { motion } from "framer-motion";
import {
  User,
  Shield,
  Lock,
  Server,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { formatDateTime } from "../utils/format";

const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

export default function Settings() {
  const { user } = useAuthenticator((ctx) => [ctx.user]);

  const email = user?.signInDetails?.loginId || user?.username || "—";
  const userId = user?.userId || "—";

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-6">
      {/* Account */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center">
            <User size={18} className="text-primary-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Account</h2>
            <p className="text-xs text-gray-500">Your authenticated identity</p>
          </div>
        </div>
        <dl className="space-y-3">
          <div className="flex justify-between text-sm">
            <dt className="text-gray-500">Email</dt>
            <dd className="text-white font-mono text-xs">{email}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className="text-gray-500">User ID</dt>
            <dd className="text-gray-400 font-mono text-xs truncate max-w-[200px]">
              {userId}
            </dd>
          </div>
        </dl>
      </motion.section>

      {/* Demo mode */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass-card p-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
            <Eye size={18} className="text-orange-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Demo Mode</h2>
            <p className="text-xs text-gray-500">
              {isDemoMode ? "Currently enabled" : "Currently disabled"}
            </p>
          </div>
        </div>
        <div className={`p-4 rounded-lg border ${isDemoMode ? "bg-orange-500/5 border-orange-500/20" : "bg-surface-2 border-border"}`}>
          {isDemoMode ? (
            <>
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-orange-300 font-medium">Demo mode is active</p>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                This deployment uses sample data and relaxed policies for demonstration
                purposes. Do not upload real personal documents or sensitive information.
                AI responses may use pre-seeded content rather than your actual files.
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-400 leading-relaxed">
              Demo mode is controlled by the <code className="text-primary-400">VITE_DEMO_MODE</code> environment
              variable at build time. In production, your documents are stored in your
              private encrypted vault with real AI extraction and no sample data.
            </p>
          )}
        </div>
      </motion.section>

      {/* Security */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Shield size={18} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Security</h2>
            <p className="text-xs text-gray-500">How your data is protected</p>
          </div>
        </div>
        <ul className="space-y-4">
          {[
            {
              icon: Lock,
              title: "Encryption at rest",
              desc: "All documents are encrypted with AES-256 in S3. Uploads include server-side encryption headers.",
            },
            {
              icon: Shield,
              title: "Authentication",
              desc: "Access requires AWS Cognito authentication. JWT tokens are sent with every API request.",
            },
            {
              icon: Server,
              title: "Isolated storage",
              desc: "Each user's documents are stored under a unique owner prefix. Cross-user access is blocked at the API layer.",
            },
            {
              icon: Eye,
              title: "Human approval for sharing",
              desc: "Creating share links requires explicit confirmation. AI can suggest packages but cannot share without your approval.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <li key={title} className="flex gap-3">
              <Icon size={16} className="text-gray-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-white">{title}</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </motion.section>

      {/* App info */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="glass-card p-6"
      >
        <p className="text-xs text-gray-600 text-center">
          DocVault v1.0 · Built with React, AWS Lambda, S3, DynamoDB, and Bedrock
        </p>
        <p className="text-xs text-gray-700 text-center mt-1">
          Session active since {formatDateTime(new Date().toISOString())}
        </p>
      </motion.section>
    </div>
  );
}
