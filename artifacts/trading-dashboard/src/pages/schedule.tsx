import React, { useEffect, useState } from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Plane, CalendarClock, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function Schedule() {
  const { data: vacData, refetch: refetchVac } = useApiData<any>('/vacation');
  const { data: schedData, refetch: refetchSched } = useApiData<any>('/schedule');
  
  const [schedule, setSchedule] = useState({
    enabled: false,
    trading_start_hour: 0,
    trading_end_hour: 24,
    trading_days: '1,2,3,4,5,6,7'
  });

  useEffect(() => {
    if (schedData) {
      setSchedule(schedData);
    }
  }, [schedData]);

  const toggleVacation = async (checked: boolean) => {
    try {
      await apiFetch('/vacation/toggle', {
        method: 'POST',
        body: JSON.stringify({ enabled: checked })
      });
      toast.success(checked ? 'Vacation mode activated. Bot paused.' : 'Vacation mode disabled. Bot ready.');
      refetchVac();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const saveSchedule = async () => {
    try {
      await apiFetch('/schedule/save', {
        method: 'POST',
        body: JSON.stringify(schedule)
      });
      toast.success('Trading hours updated');
      refetchSched();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Schedule & Availability</h2>
        <p className="text-muted-foreground">Control when the bot is allowed to trade.</p>
      </div>

      <Card className={`border-2 ${vacData?.vacation_mode ? 'border-primary bg-primary/5' : 'border-border'}`}>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Plane className="h-5 w-5 text-primary" />
              Vacation Mode
            </CardTitle>
            <CardDescription>Hard-pause all trading immediately. Will not open new positions until disabled.</CardDescription>
          </div>
          <Switch 
            checked={vacData?.vacation_mode || false} 
            onCheckedChange={toggleVacation}
            className="data-[state=checked]:bg-primary"
          />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Trading Hours Configuration
          </CardTitle>
          <CardDescription>Restrict trading to specific hours of the day (UTC time).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center space-x-2">
            <Switch 
              id="sched-enable" 
              checked={schedule.enabled} 
              onCheckedChange={(c) => setSchedule({...schedule, enabled: c})} 
            />
            <Label htmlFor="sched-enable">Enable Schedule Restrictions</Label>
          </div>

          {schedule.enabled && (
            <div className="grid gap-4 md:grid-cols-2 bg-muted/30 p-4 rounded-lg border border-border">
              <div className="space-y-2">
                <Label>Start Hour (0-23 UTC)</Label>
                <Input 
                  type="number" 
                  min="0" max="23" 
                  value={schedule.trading_start_hour}
                  onChange={(e) => setSchedule({...schedule, trading_start_hour: parseInt(e.target.value)})}
                />
              </div>
              <div className="space-y-2">
                <Label>End Hour (0-24 UTC)</Label>
                <Input 
                  type="number" 
                  min="1" max="24" 
                  value={schedule.trading_end_hour}
                  onChange={(e) => setSchedule({...schedule, trading_end_hour: parseInt(e.target.value)})}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Trading Days (1=Mon, 7=Sun)</Label>
                <Input 
                  value={schedule.trading_days}
                  onChange={(e) => setSchedule({...schedule, trading_days: e.target.value})}
                  placeholder="1,2,3,4,5"
                />
                <p className="text-xs text-muted-foreground mt-1">Comma separated list of days the bot is allowed to run.</p>
              </div>
            </div>
          )}

          <Button onClick={saveSchedule} className="w-full sm:w-auto">
            <Save className="h-4 w-4 mr-2" /> Save Schedule
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
