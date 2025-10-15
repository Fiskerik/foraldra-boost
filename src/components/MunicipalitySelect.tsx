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
  parentNumber: 0 | 1 | 2;
  selectedMunicipality: string;
  onMunicipalityChange: (municipality: string, taxRate: number) => void;
}

export function MunicipalitySelect({
  parentNumber,
  selectedMunicipality,
  onMunicipalityChange,
}: MunicipalitySelectProps) {
  const [open, setOpen] = useState(false);
  const parentClass = parentNumber === 1 ? "parent1" : parentNumber === 2 ? "parent2" : "accent";
  const headerClass = parentNumber === 0 ? 'bg-accent/10' : parentNumber === 1 ? 'bg-parent1/10' : 'bg-parent2/10';
  const titleText = parentNumber === 0 ? 'Kommun (samma för båda föräldrarna)' : `Kommun - Förälder ${parentNumber}`;
  
  const currentMunicipality = municipalities.find(
    (m) => m.name === selectedMunicipality
  );

  return (
    <Card className="shadow-card">
      <CardHeader className={`${headerClass} p-2 md:p-6`}>
        <CardTitle className={`text-${parentClass} text-sm md:text-lg`}>
          {titleText}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 md:space-y-4 p-2 md:p-6">
        <div className="space-y-1.5 md:space-y-3">
          <Label htmlFor={`municipality-${parentNumber}`} className="text-[10px] md:text-base font-medium">
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
          <div className="p-1.5 md:p-4 bg-muted rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-[10px] md:text-sm font-medium">Skattesats:</span>
              <span className={`text-sm md:text-lg font-bold text-${parentClass}`}>
                {currentMunicipality.taxRate}%
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
