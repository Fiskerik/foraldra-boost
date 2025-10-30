import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Baby, User, LogOut } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export const AppLayout = ({ children }: { children: ReactNode }) => {
  const { signOut, user } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({
        title: 'Utloggad',
        description: 'Du har loggats ut.',
      });
    } catch (error) {
      console.error('Sign out error:', error);
      toast({
        title: 'Fel',
        description: 'Kunde inte logga ut. Försök igen.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-2 sm:px-4 py-3 sm:py-4 flex justify-between items-center gap-2">
          <Link to="/dashboard" className="flex items-center gap-1 sm:gap-2 hover:opacity-80 transition-opacity min-w-0 flex-shrink">
            <Baby className="h-5 w-5 sm:h-6 sm:w-6 text-primary flex-shrink-0" />
            <span className="font-semibold text-xs sm:text-base md:text-lg truncate">
              <span className="hidden sm:inline">Föräldraledighetsplaneraren</span>
              <span className="sm:hidden">Föräldral.planeraren</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2 md:gap-4 flex-shrink-0">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm" className="text-xs sm:text-sm">
                <span className="hidden sm:inline">Mina planer</span>
                <span className="sm:hidden">Planer</span>
              </Button>
            </Link>
            <Link to="/">
              <Button variant="ghost" size="sm" className="text-xs sm:text-sm">
                <span className="hidden sm:inline">Ny plan</span>
                <span className="sm:hidden">Ny</span>
              </Button>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="px-2 py-1.5 text-sm font-medium">{user?.email}</div>
                <DropdownMenuItem asChild>
                  <Link to="/profile">Profil</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Logga ut
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
};
