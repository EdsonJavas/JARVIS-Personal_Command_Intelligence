// Design reminder: Industrial Holographic Command Deck — dark mineral surfaces, cyan relay light,
// amber instrument signals, asymmetrical command layout, honest local system states.
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import { BOARD_PATH, LOGIN_PATH } from "./const";

function Router() {
  // Home e painel exigem sessão e redirecionam sozinhos para LOGIN_PATH.
  // O painel existe como rota própria para poder ser aberto numa segunda janela,
  // em outro monitor, sem carregar o núcleo junto.
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path={BOARD_PATH} component={Dashboard} />
      <Route path={LOGIN_PATH} component={Login} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
