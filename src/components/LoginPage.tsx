import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import labelBeeLogoNoByline from "@/assets/labelbee-logo-no-byline.png";
import labelBeeDarkSailLogo from "@/assets/labelbee-dark-sail.png";

export const LoginPage = () => {
  const { login, isAuthRequired, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentLogoIndex, setCurrentLogoIndex] = useState(0);
  const logos = [labelBeeLogoNoByline, labelBeeDarkSailLogo];

  // Redirect if already authenticated or auth not required
  useEffect(() => {
    if (!isAuthRequired || isAuthenticated) {
      navigate('/');
    }
  }, [isAuthRequired, isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error('Please enter email and password');
      return;
    }

    setIsLoading(true);
    const result = await login(email, password);
    setIsLoading(false);

    if (!result.success) {
      toast.error(result.error || 'Login failed');
    } else {
      toast.success('Login successful');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-8 mt-6">
            <img 
              src={logos[currentLogoIndex]} 
              alt="LabelBee Logo" 
              className="h-[120px] w-auto cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setCurrentLogoIndex((prev) => (prev + 1) % logos.length)}
            />
          </div>
          <CardTitle className="text-2xl font-bold">Sign in</CardTitle>
          <CardDescription>
            Enter your credentials to access the annotation tool
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
            <Button 
              type="button" 
              variant="ghost" 
              className="w-full" 
              onClick={() => navigate('/')}
            >
              Back to app
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
