import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { municipalities } from "@/data/municipalities";

interface MunicipalitySelectProps {
  parentNumber: 1 | 2;
  selectedMunicipality: string;
  onMunicipalityChange: (municipality: string, taxRate: number) => void;
}

export function MunicipalitySelect({
  parentNumber,
  selectedMunicipality,
  onMunicipalityChange,
}: MunicipalitySelectProps) {
  const [open, setOpen] = useState(false);
  const parentClass = parentNumber === 1 ? "parent1" : "parent2";
  
  const currentMunicipality = municipalities.find(
    (m) => m.name === selectedMunicipality
  );

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className={`text-${parentClass}`}>
          Kommun - Förälder {parentNumber}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Label htmlFor={`municipality-${parentNumber}`} className="text-base font-medium">
            Välj kommun
          </Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                id={`municipality-${parentNumber}`}
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between"
              >
                {selectedMunicipality || "Välj kommun..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0 bg-popover z-50" align="start">
              <Command>
                <CommandInput placeholder="Sök kommun..." />
                <CommandList>
                  <CommandEmpty>Ingen kommun hittades.</CommandEmpty>
                  <CommandGroup>
                    {municipalities.map((municipality) => (
                      <CommandItem
                        key={municipality.name}
                        value={municipality.name}
                        onSelect={(currentValue) => {
                          const selected = municipalities.find(
                            (m) => m.name.toLowerCase() === currentValue.toLowerCase()
                          );
                          if (selected) {
                            onMunicipalityChange(selected.name, selected.taxRate);
                            setOpen(false);
                          }
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedMunicipality === municipality.name
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        <span className="flex-1">{municipality.name}</span>
                        <span className="text-muted-foreground text-sm">
                          {municipality.taxRate}%
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {currentMunicipality && (
          <div className="p-4 bg-muted rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Skattesats:</span>
              <span className={`text-lg font-bold text-${parentClass}`}>
                {currentMunicipality.taxRate}%
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
