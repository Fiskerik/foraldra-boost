import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

export default function Profile() {
  const { user, updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast({
        title: 'Lösenorden matchar inte',
        description: 'Se till att båda lösenorden är identiska.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: 'Lösenordet är för kort',
        description: 'Lösenordet måste vara minst 6 tecken långt.',
        variant: 'destructive',
      });
      return;
    }

    setIsUpdating(true);
    try {
      const { error } = await updatePassword(newPassword);
      if (error) {
        toast({
          title: 'Fel',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Lösenord uppdaterat!',
          description: 'Ditt lösenord har ändrats.',
        });
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (error) {
      console.error('Update password error:', error);
      toast({
        title: 'Fel',
        description: 'Något gick fel. Försök igen.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/auth');
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
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Profil</h1>
        <p className="text-muted-foreground mb-8">
          Hantera dina kontoinställningar
        </p>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Kontoinformation</CardTitle>
            <CardDescription>Din registrerade information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input value={user?.email || ''} disabled />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Byt lösenord</CardTitle>
            <CardDescription>Uppdatera ditt lösenord</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <Label htmlFor="new-password">Nytt lösenord</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div>
                <Label htmlFor="confirm-password">Bekräfta nytt lösenord</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" disabled={isUpdating}>
                {isUpdating ? 'Uppdaterar...' : 'Uppdatera lösenord'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Farlig zon</CardTitle>
            <CardDescription>Permanenta åtgärder för ditt konto</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Button variant="outline" onClick={handleSignOut} className="w-full sm:w-auto">
                Logga ut
              </Button>
            </div>
            <Separator />
            <div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full sm:w-auto">
                    Ta bort konto
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Är du säker?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Detta kommer permanent ta bort ditt konto och alla dina sparade planer.
                      Denna åtgärd kan inte ångras.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Avbryt</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => {
                        toast({
                          title: 'Funktionen är inte implementerad ännu',
                          description: 'Kontakta supporten för att ta bort ditt konto.',
                        });
                      }}
                    >
                      Ta bort konto
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
