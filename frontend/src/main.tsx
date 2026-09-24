import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import { Authenticator, ThemeProvider } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import "./index.css";
import App from "./App";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID as string,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID as string,
    },
  },
});

const amplifyTheme = {
  name: "docvault-theme",
  tokens: {
    colors: {
      background: {
        primary: { value: "#0a0a0f" },
        secondary: { value: "#13131a" },
      },
      font: {
        primary: { value: "#f9fafb" },
        secondary: { value: "#9ca3af" },
      },
      brand: {
        primary: {
          "10": { value: "#eef2ff" },
          "20": { value: "#e0e7ff" },
          "40": { value: "#818cf8" },
          "60": { value: "#6366f1" },
          "80": { value: "#4f46e5" },
          "90": { value: "#4338ca" },
          "100": { value: "#312e81" },
        },
      },
    },
    components: {
      authenticator: {
        router: {
          borderWidth: { value: "1px" },
          borderColor: { value: "#1e1e2e" },
          backgroundColor: { value: "#13131a" },
        },
      },
    },
  },
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={amplifyTheme} colorMode="dark">
      <Authenticator
        loginMechanisms={["email"]}
        signUpAttributes={["email"]}
        components={{
          Header() {
            return (
              <div className="flex flex-col items-center py-8">
                <div className="flex items-center gap-3 mb-2">
                  <img src="/logo.png" alt="DocVault" className="w-12 h-12 rounded-2xl object-cover" />
                  <span className="text-2xl font-bold text-white">DocVault</span>
                </div>
                <p className="text-gray-400 text-sm">Your secure document vault</p>
              </div>
            );
          },
        }}
      >
        {() => <App />}
      </Authenticator>
    </ThemeProvider>
  </React.StrictMode>
);
