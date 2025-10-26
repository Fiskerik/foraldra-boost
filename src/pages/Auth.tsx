import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Baby, Heart, Shield } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (searchParams.get('reset') === 'true') {
      setShowReset(true);
    }
  }, [searchParams]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await signIn(email, password);
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          toast({
            title: 'Felaktig inloggning',
            description: 'Email eller lösenord är fel. Försök igen.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Fel',
            description: error.message,
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: 'Välkommen tillbaka!',
          description: 'Du är nu inloggad.',
        });
      }
    } catch (error) {
      console.error('Sign in error:', error);
      toast({
        title: 'Fel',
        description: 'Något gick fel. Försök igen.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await signUp(email, password, fullName);
      if (error) {
        if (error.message.includes('User already registered')) {
          toast({
            title: 'Kontot finns redan',
            description: 'Ett konto med denna email finns redan. Försök logga in istället.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Fel',
            description: error.message,
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: 'Konto skapat!',
          description: 'Du kan nu logga in med ditt nya konto.',
        });
        // Auto-navigate after successful signup since auto-confirm is enabled
        navigate('/dashboard');
      }
    } catch (error) {
      console.error('Sign up error:', error);
      toast({
        title: 'Fel',
        description: 'Något gick fel. Försök igen.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        toast({
          title: 'Fel',
          description: 'Kunde inte logga in med Google. Försök igen.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Google sign in error:', error);
      toast({
        title: 'Fel',
        description: 'Något gick fel. Försök igen.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await resetPassword(email);
      if (error) {
        toast({
          title: 'Fel',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Email skickat!',
          description: 'Kolla din inkorg för instruktioner om hur du återställer ditt lösenord.',
        });
        setShowReset(false);
      }
    } catch (error) {
      console.error('Reset password error:', error);
      toast({
        title: 'Fel',
        description: 'Något gick fel. Försök igen.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (showReset) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Shield className="h-12 w-12 text-primary" />
            </div>
            <CardTitle>Återställ lösenord</CardTitle>
            <CardDescription>
              Ange din email så skickar vi instruktioner för att återställa ditt lösenord
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="din@email.se"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Skickar...' : 'Skicka återställningslänk'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setShowReset(false)}
              >
                Tillbaka till inloggning
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Baby className="h-16 w-16 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Föräldraledighetsplaneraren</h1>
          <p className="text-muted-foreground">
            Planera och spara din föräldraledighet smart
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Kom igång</CardTitle>
            <CardDescription>
              Skapa ett konto eller logga in för att spara dina planer
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin" className="space-y-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Logga in</TabsTrigger>
                <TabsTrigger value="signup">Skapa konto</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="din@email.se"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Lösenord</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Loggar in...' : 'Logga in'}
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="w-full"
                    onClick={() => setShowReset(true)}
                  >
                    Glömt lösenord?
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Namn (valfritt)</Label>
                    <Input
                      id="signup-name"
                      type="text"
                      placeholder="Ditt namn"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="din@email.se"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Lösenord</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Skapar konto...' : 'Skapa konto'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Eller</span>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
            >
              <Heart className="mr-2 h-4 w-4" />
              Fortsätt med Google
            </Button>
          </CardContent>
        </Card>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>
            Genom att skapa ett konto godkänner du våra{' '}
            <a href="#" className="underline hover:text-primary">
              villkor
            </a>{' '}
            och{' '}
            <a href="#" className="underline hover:text-primary">
              integritetspolicy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
